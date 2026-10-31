import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { accountGroupsApi } from '../src/services/api/accountGroups';
import { apiClient } from '../src/services/api/client';
import { useAccountGroupsStore } from '../src/stores/useAccountGroupsStore';

const base = [{ id: 'g-1', name: 'Pro' }];

afterEach(() => {
  useAccountGroupsStore.getState().reset();
});

describe('account groups API', () => {
  test('list/replace/assign use the account-groups endpoints and normalize responses', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({
      groups: [{ id: 'g-1', name: ' Pro ', color: '#7C3AED' }, { id: '', name: 'bad' }, 'x'],
    });
    const put = spyOn(apiClient, 'put').mockResolvedValue({ groups: base, cleared: 2 });
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      updated: ['a.json'],
      failed: [{ name: 'b.json', error: 'nope' }, { error: 'no name' }],
    });
    try {
      expect(await accountGroupsApi.list()).toEqual([{ id: 'g-1', name: 'Pro', color: '#7C3AED' }]);
      expect(get).toHaveBeenCalledWith('/account-groups');
      expect(await accountGroupsApi.replace([{ name: 'Pro' }])).toEqual({
        groups: base,
        cleared: 2,
      });
      expect(put).toHaveBeenCalledWith('/account-groups', { groups: [{ name: 'Pro' }] });
      expect(await accountGroupsApi.assign('', ['a.json', 'b.json'])).toEqual({
        updated: ['a.json'],
        failed: [{ name: 'b.json', error: 'nope' }],
      });
      expect(post).toHaveBeenCalledWith('/account-groups/assign', {
        group_id: '',
        names: ['a.json', 'b.json'],
      });
    } finally {
      get.mockRestore();
      put.mockRestore();
      post.mockRestore();
    }
  });
});

describe('account groups store', () => {
  test('load stores groups and marks the backend as supported', async () => {
    const list = spyOn(accountGroupsApi, 'list').mockResolvedValue(base);
    try {
      await useAccountGroupsStore.getState().load();
      expect(useAccountGroupsStore.getState()).toMatchObject({ groups: base, supported: true });
    } finally {
      list.mockRestore();
    }
  });

  test('a 404 list marks the backend as unsupported; other errors keep it unknown', async () => {
    const list = spyOn(accountGroupsApi, 'list').mockRejectedValue(
      Object.assign(new Error('not found'), { status: 404 })
    );
    try {
      await useAccountGroupsStore.getState().load();
      expect(useAccountGroupsStore.getState().supported).toBe(false);
      useAccountGroupsStore.getState().reset();
      list.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
      await useAccountGroupsStore.getState().load();
      expect(useAccountGroupsStore.getState().supported).toBeNull();
    } finally {
      list.mockRestore();
    }
  });

  test('save applies optimistically, then uses the server response as truth', async () => {
    useAccountGroupsStore.setState({ groups: base, supported: true });
    const seen: string[][] = [];
    const replace = spyOn(accountGroupsApi, 'replace').mockImplementation(async () => {
      seen.push(useAccountGroupsStore.getState().groups.map((group) => group.id));
      return {
        groups: [
          { id: 'g-1', name: 'Pro' },
          { id: 'g-new', name: 'New' },
        ],
        cleared: 0,
      };
    });
    try {
      const result = await useAccountGroupsStore.getState().save([
        { id: 'g-1', name: 'Pro' },
        { id: '', name: 'New' },
      ]);
      expect(seen[0]).toEqual(['g-1', 'pending-1']);
      expect(result.map((group) => group.id)).toEqual(['g-1', 'g-new']);
      expect(useAccountGroupsStore.getState().groups.map((group) => group.id)).toEqual([
        'g-1',
        'g-new',
      ]);
    } finally {
      replace.mockRestore();
    }
  });

  test('save rolls back and rethrows when the server rejects', async () => {
    useAccountGroupsStore.setState({ groups: base, supported: true });
    const replace = spyOn(accountGroupsApi, 'replace').mockRejectedValue(
      new Error('duplicate name')
    );
    try {
      await expect(useAccountGroupsStore.getState().save([])).rejects.toThrow('duplicate name');
      expect(useAccountGroupsStore.getState().groups).toEqual(base);
    } finally {
      replace.mockRestore();
    }
  });
});
