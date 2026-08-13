import { resolveLanguagePhraseState } from './languagePhraseResolver.js';
import {
  createLanguagePhraseSourceKey,
  LANGUAGE_PHRASE_EVENTS,
} from '../utils/languagePhrases.js';

export function createLanguagePhraseSession({ analysisOptions, provider }) {
  const cache = new Map();
  const pending = new Map();
  let sourceKey = createLanguagePhraseSourceKey([]);
  let state = null;

  function syncMeasures(measures) {
    const nextSourceKey = createLanguagePhraseSourceKey(measures);

    if (nextSourceKey === sourceKey) return false;

    sourceKey = nextSourceKey;
    state = null;
    cache.clear();
    return true;
  }

  async function resolve(measures) {
    syncMeasures(measures);

    if (cache.has(sourceKey)) {
      state = cache.get(sourceKey);
      return { fromCache: true, state };
    }

    if (!pending.has(sourceKey)) {
      const requestSourceKey = sourceKey;
      const request = resolveLanguagePhraseState({
        analysisOptions,
        measures,
        provider,
      }).then(
        (nextState) => {
          if (sourceKey !== requestSourceKey) {
            throw new Error('가사가 변경되어 이전 AI 분석 결과를 폐기했습니다.');
          }

          if (
            nextState.fallbackWindowCount === 0 &&
            nextState.displayCueFallbackCount === 0
          ) {
            cache.set(requestSourceKey, nextState);
          }
          state = nextState;
          return nextState;
        },
      );

      pending.set(requestSourceKey, request);
      request.finally(() => pending.delete(requestSourceKey)).catch(() => {});
    }

    return { fromCache: false, state: await pending.get(sourceKey) };
  }

  return {
    clear() {
      cache.clear();
      pending.clear();
      sourceKey = createLanguagePhraseSourceKey([]);
      state = null;
    },
    getState: () => state,
    resolve,
    syncMeasures,
  };
}

export function sendLanguagePhraseState(socket, session) {
  socket.emit(LANGUAGE_PHRASE_EVENTS.STATE, session.getState());
}

export function registerLanguagePhraseSocketHandlers({
  getMeasures,
  io,
  session,
  socket,
}) {
  socket.on(LANGUAGE_PHRASE_EVENTS.RESOLVE, async (_request, acknowledge) => {
    try {
      const result = await session.resolve(getMeasures());

      io.emit(LANGUAGE_PHRASE_EVENTS.STATE, result.state);
      acknowledge?.({
        fromCache: result.fromCache,
        ok: true,
        state: result.state,
      });
    } catch (error) {
      console.error('[vocal-phrases] resolution failed', error);
      acknowledge?.({
        error:
          error instanceof Error
            ? error.message
            : 'AI 가사 문장 정리에 실패했습니다.',
        ok: false,
      });
    }
  });
}
