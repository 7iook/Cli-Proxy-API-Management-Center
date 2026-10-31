/**
 * Account group registry (display-only), mirrored from the backend.
 * `supported` is null until the first list answers; a 404 means an older backend.
 */

import { create } from 'zustand';
import { accountGroupsApi, type AccountGroup } from '@/services/api/accountGroups';

interface AccountGroupsState {
  groups: AccountGroup[];
  supported: boolean | null;
  loading: boolean;
  load: () => Promise<void>;
  /** Optimistic; rolls back and rethrows on failure. Returns the server-confirmed list. */
  save: (nextGroups: AccountGroup[]) => Promise<AccountGroup[]>;
  reset: () => void;
}

let loadToken = 0;

export const useAccountGroupsStore = create<AccountGroupsState>((set, get) => ({
  groups: [],
  supported: null,
  loading: false,

  load: async () => {
    const token = (loadToken += 1);
    set({ loading: true });
    try {
      const groups = await accountGroupsApi.list();
      if (token !== loadToken) return;
      set({ groups, supported: true, loading: false });
    } catch (error: unknown) {
      if (token !== loadToken) return;
      if ((error as { status?: number } | null)?.status === 404) {
        set({ groups: [], supported: false, loading: false });
        return;
      }
      // Transient failure: keep whatever is known.
      set({ loading: false });
    }
  },

  save: async (nextGroups) => {
    const previous = get().groups;
    loadToken += 1; // a slower in-flight list must not overwrite the result
    // Unsaved groups have no id yet; give them a placeholder so keys and filters stay unique.
    set({
      groups: nextGroups.map((group, index) =>
        group.id ? group : { ...group, id: `pending-${index}` }
      ),
    });
    try {
      const result = await accountGroupsApi.replace(nextGroups);
      set({ groups: result.groups, supported: true });
      return result.groups;
    } catch (error) {
      set({ groups: previous });
      throw error;
    }
  },

  reset: () => {
    loadToken += 1;
    set({ groups: [], supported: null, loading: false });
  },
}));
