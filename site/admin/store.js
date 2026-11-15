import { emptyStore, isValidStore } from '../domain.js';
const CONFLICT_MESSAGE = 'Changed elsewhere — saving is paused. Your edits are kept in this tab. Export a copy before reloading the latest data.';

/** @typedef {import('../models.js').Store} Store */
/**
 * Optimistic state with one in-flight save. A conflict pauses saving and keeps
 * local edits available for export; queued writes must never clear that conflict.
 * @param {{fetcher?: typeof fetch, onChange?: (store: Store) => void, onError?: (message: string, retry: boolean) => void, onSaved?: () => void}} [options]
 */
export function createStoreClient({ fetcher = fetch, onChange = () => {}, onError = () => {}, onSaved = () => {} } = {}) {
  /** @type {Store} */
  let state = emptyStore();
  /** @type {Promise<void>|null} */
  let pending = null;
  let dirty = false;
  let conflicted = false;

  async function save() {
    while (dirty && !conflicted) {
      dirty = false;
      const snapshot = state;
      try {
        const response = await fetcher('/api/store', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'trip-planner' },
          body: JSON.stringify(snapshot),
        });
        if (response.status === 409) {
          conflicted = true;
          dirty = true;
          onError(CONFLICT_MESSAGE, false);
          break;
        }
        if (!response.ok) {
          dirty = true;
          onError('Not saved — the server rejected the change. Try saving again.', true);
          break;
        }
        const result = await response.json();
        if (!Number.isInteger(result?.rev)) throw new Error('Invalid save response');
        // Edits made while this request was pending keep their values and get the new revision.
        state = { ...state, rev: result.rev };
        onSaved();
      } catch {
        dirty = true;
        onError("Couldn't confirm the save. Keep this page open and retry when the connection is back.", true);
        break;
      }
    }
  }

  function flush() {
    if (!pending && dirty && !conflicted) pending = save().finally(() => { pending = null; });
    return pending ?? Promise.resolve();
  }

  return {
    getState: () => state,
    async load() {
      const response = await fetcher('/api/store');
      if (!response.ok) throw new Error('Could not load trips');
      const data = await response.json();
      if (!isValidStore(data)) throw new Error('Invalid trip data');
      state = data;
      dirty = false;
      conflicted = false;
      onChange(state);
    },
    /** @param {Store} next */
    commit(next) {
      state = { ...next, rev: state.rev };
      dirty = true;
      onChange(state);
      if (conflicted) onError(CONFLICT_MESSAGE, false);
      return flush();
    },
    retry: flush,
  };
}
