/**
 * Panel display preferences, shared by everyone who manages this server.
 * A 404 means an older backend: callers fall back to browser-only storage.
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export interface PanelPreferencesDocument {
  /** null when the server has no document yet (revision "0"). */
  preferences: unknown | null;
  revision: string;
  updatedAt: string | null;
}

/** The server's document changed since `base_revision`; carries the current one. */
export class PreferencesConflictError extends Error {
  constructor(readonly document: PanelPreferencesDocument) {
    super('panel preferences revision conflict');
    this.name = 'PreferencesConflictError';
  }
}

const PATH = '/panel-preferences';

export const normalizePreferencesDocument = (data: unknown): PanelPreferencesDocument => {
  const record = isRecord(data) ? data : {};
  return {
    preferences: isRecord(record.preferences) ? record.preferences : null,
    revision:
      typeof record.revision === 'string' || typeof record.revision === 'number'
        ? String(record.revision)
        : '0',
    updatedAt: typeof record.updated_at === 'string' ? record.updated_at : null,
  };
};

const statusOf = (error: unknown): number | undefined =>
  (error as { status?: number } | null)?.status;

export const panelPreferencesApi = {
  /** Resolves null when the backend does not support preferences (404). */
  async get(): Promise<PanelPreferencesDocument | null> {
    try {
      return normalizePreferencesDocument(await apiClient.get<unknown>(PATH));
    } catch (error: unknown) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  },

  /** Rejects with PreferencesConflictError on 409; a 404 propagates as an ApiError. */
  async put(preferences: unknown, baseRevision: string): Promise<PanelPreferencesDocument> {
    try {
      return normalizePreferencesDocument(
        await apiClient.put<unknown>(PATH, { preferences, base_revision: baseRevision })
      );
    } catch (error: unknown) {
      if (statusOf(error) === 409) {
        throw new PreferencesConflictError(
          normalizePreferencesDocument((error as { data?: unknown }).data)
        );
      }
      throw error;
    }
  },
};
