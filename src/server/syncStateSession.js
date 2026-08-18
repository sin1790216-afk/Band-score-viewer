import {
  createEmptySharedSessionState,
  getLogicalSyncState,
} from '../state/sessionState.js';

export function createSyncStateSession(initialSyncState) {
  let latestSyncState = getLogicalSyncState(
    initialSyncState || createEmptySharedSessionState().syncState,
  );

  return {
    getState() {
      return latestSyncState;
    },

    reset(nextSyncState) {
      latestSyncState = getLogicalSyncState(
        nextSyncState || createEmptySharedSessionState().syncState,
      );
      return latestSyncState;
    },

    update(nextSyncState) {
      latestSyncState = getLogicalSyncState({
        ...latestSyncState,
        ...nextSyncState,
      });
      return latestSyncState;
    },
  };
}
