export const SESSION_ACTIONS = {
  APPLY_SYNC_STATE: 'session/apply-sync-state',
  RESET_POSITION: 'session/reset-position',
  SET_AUTO_PLAYING: 'session/set-auto-playing',
  SET_MEASURE_INDEX: 'session/set-measure-index',
  SET_PAGE_NUMBER: 'session/set-page-number',
  SET_REPEAT_ENABLED: 'session/set-repeat-enabled',
  SET_RETURN_TO_START_ON_END: 'session/set-return-to-start-on-end',
};

export const INITIAL_SYNC_STATE = {
  fileName: '',
  pageNumber: 1,
  measureIndex: 0,
};

export const INITIAL_SESSION_STATE = {
  isAutoPlaying: false,
  isRepeatEnabled: false,
  returnToStartOnEnd: false,
  measureIndex: 0,
  pageNumber: 1,
  syncState: INITIAL_SYNC_STATE,
};

export function getLogicalSyncState(syncState) {
  return {
    fileName: syncState?.fileName || '',
    pageNumber: syncState?.pageNumber || 1,
    measureIndex: syncState?.measureIndex || 0,
  };
}

export function createInitialSessionState(initialState = {}) {
  return {
    ...INITIAL_SESSION_STATE,
    ...initialState,
    syncState: getLogicalSyncState({
      ...INITIAL_SYNC_STATE,
      ...initialState.syncState,
    }),
  };
}

export function sessionReducer(state, action) {
  switch (action.type) {
    case SESSION_ACTIONS.SET_PAGE_NUMBER:
      return {
        ...state,
        pageNumber: action.pageNumber,
      };

    case SESSION_ACTIONS.SET_MEASURE_INDEX:
      return {
        ...state,
        measureIndex: action.measureIndex,
      };

    case SESSION_ACTIONS.SET_AUTO_PLAYING:
      return {
        ...state,
        isAutoPlaying: Boolean(action.isAutoPlaying),
      };

    case SESSION_ACTIONS.SET_REPEAT_ENABLED:
      return {
        ...state,
        isRepeatEnabled: Boolean(action.isRepeatEnabled),
      };

    case SESSION_ACTIONS.SET_RETURN_TO_START_ON_END:
      return {
        ...state,
        returnToStartOnEnd: Boolean(action.returnToStartOnEnd),
      };

    case SESSION_ACTIONS.APPLY_SYNC_STATE:
      return {
        ...state,
        syncState: getLogicalSyncState({
          ...state.syncState,
          ...action.syncState,
        }),
      };

    case SESSION_ACTIONS.RESET_POSITION:
      return {
        ...state,
        isAutoPlaying: false,
        measureIndex: 0,
        pageNumber: 1,
      };

    default:
      return state;
  }
}
