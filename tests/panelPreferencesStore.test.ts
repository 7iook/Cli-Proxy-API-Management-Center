import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import {
  panelPreferencesApi,
  PreferencesConflictError,
  type PanelPreferencesDocument,
} from '../src/services/api/panelPreferences';
import { DEFAULT_PREFERENCES, mergePreferences } from '../src/features/preferences/schema';
import {
  PREFERENCES_FLUSH_DELAY_MS,
  usePanelPreferencesStore,
} from '../src/stores/usePanelPreferencesStore';

const store = usePanelPreferencesStore;
const doc = (revision: string, preferences: unknown = null): PanelPreferencesDocument => ({
  preferences,
  revision,
  updatedAt: null,
});

let getSpy: ReturnType<typeof spyOn<typeof panelPreferencesApi, 'get'>>;
let putSpy: ReturnType<typeof spyOn<typeof panelPreferencesApi, 'put'>>;

beforeEach(() => {
  jest.useFakeTimers();
  store.getState().reset();
  store.setState({ prefs: DEFAULT_PREFERENCES });
  getSpy = spyOn(panelPreferencesApi, 'get');
  putSpy = spyOn(panelPreferencesApi, 'put');
});

afterEach(() => {
  getSpy.mockRestore();
  putSpy.mockRestore();
  store.getState().reset();
  jest.useRealTimers();
});

describe('panel preferences API', () => {
  test('get maps 404 to null and normalizes the envelope', async () => {
    const get = spyOn(apiClient, 'get');
    getSpy.mockRestore();
    try {
      get.mockResolvedValueOnce({ preferences: { version: 1 }, revision: 3, updated_at: 'now' });
      expect(await panelPreferencesApi.get()).toEqual({
        preferences: { version: 1 },
        revision: '3',
        updatedAt: 'now',
      });
      expect(get).toHaveBeenCalledWith('/panel-preferences');
      get.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
      expect(await panelPreferencesApi.get()).toBeNull();
      get.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
      await expect(panelPreferencesApi.get()).rejects.toThrow('boom');
    } finally {
      get.mockRestore();
      getSpy = spyOn(panelPreferencesApi, 'get');
    }
  });

  test('put sends base_revision and turns 409 into a typed conflict with the server document', async () => {
    const put = spyOn(apiClient, 'put');
    putSpy.mockRestore();
    try {
      put.mockResolvedValueOnce({ preferences: { version: 1 }, revision: '2' });
      await panelPreferencesApi.put({ version: 1 }, '1');
      expect(put).toHaveBeenCalledWith('/panel-preferences', {
        preferences: { version: 1 },
        base_revision: '1',
      });
      put.mockRejectedValueOnce(
        Object.assign(new Error('conflict'), {
          status: 409,
          data: { error: 'revision conflict', preferences: { version: 1 }, revision: '5' },
        })
      );
      const error = await panelPreferencesApi.put({}, '1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PreferencesConflictError);
      expect((error as PreferencesConflictError).document.revision).toBe('5');
    } finally {
      put.mockRestore();
      putSpy = spyOn(panelPreferencesApi, 'put');
    }
  });
});

describe('panel preferences store', () => {
  test('a 404 keeps the store local-only and never writes', async () => {
    getSpy.mockResolvedValue(null);
    await store.getState().load();
    expect(store.getState().syncState).toBe('local-only');
    store.getState().update({ display: { compact: true } });
    jest.advanceTimersByTime(PREFERENCES_FLUSH_DELAY_MS * 2);
    expect(putSpy).not.toHaveBeenCalled();
    expect(store.getState().prefs.display.compact).toBe(true);
  });

  test('server document wins over local values', async () => {
    store.setState({
      prefs: mergePreferences(DEFAULT_PREFERENCES, { display: { compact: true } }),
    });
    getSpy.mockResolvedValue(
      doc('4', mergePreferences(DEFAULT_PREFERENCES, { display: { maskEmail: true } }))
    );
    await store.getState().load();
    expect(store.getState().prefs.display).toEqual({ compact: false, maskEmail: true });
    expect(store.getState().syncState).toBe('synced');
    expect(putSpy).not.toHaveBeenCalled();
  });

  test('an empty server receives the local document when it differs from the defaults', async () => {
    store.setState({
      prefs: mergePreferences(DEFAULT_PREFERENCES, { display: { compact: true } }),
    });
    getSpy.mockResolvedValue(doc('0'));
    putSpy.mockResolvedValue(doc('1'));
    await store.getState().load();
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy.mock.calls[0][1]).toBe('0');
    expect((putSpy.mock.calls[0][0] as typeof DEFAULT_PREFERENCES).display.compact).toBe(true);
    expect(store.getState().syncState).toBe('synced');
  });

  test('changes are debounced into one PUT carrying the whole document and base revision', async () => {
    getSpy.mockResolvedValue(doc('2', DEFAULT_PREFERENCES));
    putSpy.mockResolvedValue(doc('3'));
    await store.getState().load();

    store.getState().update({ display: { compact: true } });
    store.getState().update({ authFiles: { sort: { field: 'weekly', direction: 'desc' } } });
    expect(store.getState().syncState).toBe('syncing');
    jest.advanceTimersByTime(PREFERENCES_FLUSH_DELAY_MS - 1);
    expect(putSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(putSpy).toHaveBeenCalledTimes(1);
    const [sent, base] = putSpy.mock.calls[0] as [typeof DEFAULT_PREFERENCES, string];
    expect(base).toBe('2');
    expect(sent.display.compact).toBe(true);
    expect(sent.authFiles.sort).toEqual({ field: 'weekly', direction: 'desc' });
    expect(store.getState().syncState).toBe('synced');

    // The new revision is used for the next write.
    store.getState().update({ display: { maskEmail: true } });
    await store.getState().flush();
    expect(putSpy.mock.calls[1][1]).toBe('3');
  });

  test('on 409 the dirty paths are re-applied on the server document and retried once', async () => {
    getSpy.mockResolvedValue(doc('2', DEFAULT_PREFERENCES));
    await store.getState().load();
    const serverDoc = mergePreferences(DEFAULT_PREFERENCES, {
      authFiles: { providerFilter: 'claude' },
      display: { compact: true },
    });
    putSpy
      .mockRejectedValueOnce(new PreferencesConflictError(doc('5', serverDoc)))
      .mockResolvedValueOnce(doc('6'));

    store.getState().update({ display: { maskEmail: true } });
    await store.getState().flush();

    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(putSpy.mock.calls[1][1]).toBe('5');
    const retried = putSpy.mock.calls[1][0] as typeof DEFAULT_PREFERENCES;
    // Other admin's untouched fields survive; our dirty field is preserved.
    expect(retried.authFiles.providerFilter).toBe('claude');
    expect(retried.display).toEqual({ compact: true, maskEmail: true });
    expect(store.getState().prefs).toEqual(retried);
    expect(store.getState().syncState).toBe('synced');
  });

  test('a second conflict keeps local values and the next change retries', async () => {
    getSpy.mockResolvedValue(doc('2', DEFAULT_PREFERENCES));
    await store.getState().load();
    putSpy
      .mockRejectedValueOnce(new PreferencesConflictError(doc('5', DEFAULT_PREFERENCES)))
      .mockRejectedValueOnce(new PreferencesConflictError(doc('6', DEFAULT_PREFERENCES)))
      .mockResolvedValueOnce(doc('7'));

    store.getState().update({ display: { maskEmail: true } });
    await store.getState().flush();
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(store.getState().syncState).toBe('error');
    expect(store.getState().prefs.display.maskEmail).toBe(true);

    store.getState().update({ display: { compact: true } });
    await store.getState().flush();
    expect(putSpy.mock.calls[2][1]).toBe('6');
    expect(store.getState().syncState).toBe('synced');
  });

  test('network errors keep dirty paths for the next attempt without losing the change', async () => {
    getSpy.mockResolvedValue(doc('2', DEFAULT_PREFERENCES));
    await store.getState().load();
    putSpy.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(doc('3'));
    store.getState().update({ display: { compact: true } });
    await store.getState().flush();
    expect(store.getState().syncState).toBe('error');
    expect(store.getState().prefs.display.compact).toBe(true);
    await store.getState().flush();
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(store.getState().syncState).toBe('synced');
  });

  test('refreshIfIdle refetches only when nothing is pending', async () => {
    getSpy.mockResolvedValue(doc('2', DEFAULT_PREFERENCES));
    await store.getState().load();
    getSpy.mockClear();
    store.getState().update({ display: { compact: true } });
    store.getState().refreshIfIdle();
    expect(getSpy).not.toHaveBeenCalled();

    putSpy.mockResolvedValue(doc('3'));
    await store.getState().flush();
    store.getState().refreshIfIdle();
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  test('reset forgets the connection so later changes stay local until the next load', async () => {
    getSpy.mockResolvedValue(doc('2', DEFAULT_PREFERENCES));
    await store.getState().load();
    store.getState().reset();
    store.getState().update({ display: { compact: true } });
    jest.advanceTimersByTime(PREFERENCES_FLUSH_DELAY_MS * 2);
    expect(putSpy).not.toHaveBeenCalled();
    expect(store.getState().syncState).toBe('local-only');
  });
});
