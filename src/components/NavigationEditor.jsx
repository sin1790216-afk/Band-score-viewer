import { useEffect, useMemo, useState } from 'react';

import {
  addNavigationEnding,
  buildNavigationModel,
  removeNavigationEnding,
  updateNavigationEndingAnchor,
} from '../utils/navigationModel.js';
import { getNavigationEndingLabel } from '../utils/navigationEndings.js';

function parseMeasureNumber(value, measureCount) {
  const measureNumber = Number(value);

  return Number.isSafeInteger(measureNumber) &&
    measureNumber >= 1 &&
    measureNumber <= measureCount
    ? measureNumber
    : null;
}

function getNextPass(section) {
  return Math.max(0, ...section.endings.flatMap((ending) => ending.passes)) + 1;
}

export default function NavigationEditor({
  disabled,
  measures,
  onReplaceMeasures,
}) {
  const navigationModel = useMemo(() => buildNavigationModel(measures), [measures]);
  const [endingDrafts, setEndingDrafts] = useState({});
  const [pendingDrafts, setPendingDrafts] = useState({});
  const [pendingSections, setPendingSections] = useState({});
  const [validationMessage, setValidationMessage] = useState('');

  useEffect(() => {
    setEndingDrafts(
      Object.fromEntries(
        navigationModel.repeatSections.flatMap((section) =>
          section.endings.map((ending) => [
            ending.id,
            String(ending.startIndex + 1),
          ]),
        ),
      ),
    );
  }, [navigationModel.repeatSections]);

  function commit(nextMeasures) {
    if (!nextMeasures) {
      setValidationMessage('입력한 마디 번호를 확인해주세요.');
      return false;
    }

    setValidationMessage('');
    onReplaceMeasures(nextMeasures);
    return true;
  }

  function submitEnding(event, ending) {
    event.preventDefault();
    const measureNumber = parseMeasureNumber(
      endingDrafts[ending.id],
      measures.length,
    );

    if (!measureNumber) {
      setValidationMessage('괄호가 시작되는 마디 번호 하나를 입력하세요.');
      return;
    }

    commit(updateNavigationEndingAnchor(measures, ending.id, measureNumber));
  }

  function submitPendingEnding(event, section) {
    event.preventDefault();
    const measureNumber = parseMeasureNumber(
      pendingDrafts[section.id],
      measures.length,
    );

    if (!measureNumber) {
      setValidationMessage('괄호가 시작되는 마디 번호 하나를 입력하세요.');
      return;
    }

    if (commit(addNavigationEnding(measures, section, measureNumber))) {
      setPendingDrafts((current) => ({ ...current, [section.id]: '' }));
      setPendingSections((current) => ({ ...current, [section.id]: false }));
    }
  }

  function beginAddingEnding(sectionId) {
    setValidationMessage('');
    setPendingDrafts((current) => ({ ...current, [sectionId]: '' }));
    setPendingSections((current) => ({ ...current, [sectionId]: true }));
  }

  return (
    <div className="navigation-direct-editor">
      {navigationModel.repeatSections.length === 0 && (
        <small className="sidebar-help">
          마디를 선택해 ||:와 :|| 도돌이표를 지정하세요.
        </small>
      )}

      {navigationModel.repeatSections.map((section, sectionIndex) => {
        const sectionLabel = navigationModel.repeatSections.length === 1
          ? '도돌이표'
          : `도돌이표 ${sectionIndex + 1}`;

        return (
          <section className="repeat-section-editor" key={section.id}>
            <strong>{sectionLabel}</strong>
            <div className="repeat-section-summary" aria-label={`${sectionLabel} 위치`}>
              <span>||: M{section.startIndex + 1}</span>
              <span>:|| M{section.endIndex + 1}</span>
            </div>

            <div className="ending-editor-list">
              <span>괄호</span>
              {section.endings.map((ending) => (
                <form
                  className="ending-editor-row"
                  key={ending.id}
                  onSubmit={(event) => submitEnding(event, ending)}
                >
                  <label>
                    <span>{getNavigationEndingLabel(ending)}</span>
                    <input
                      aria-label={`${getNavigationEndingLabel(ending)} 괄호 시작 마디`}
                      disabled={disabled}
                      inputMode="numeric"
                      min="1"
                      onChange={(event) =>
                        setEndingDrafts((current) => ({
                          ...current,
                          [ending.id]: event.target.value,
                        }))
                      }
                      placeholder="시작 마디"
                      type="number"
                      value={endingDrafts[ending.id] || ''}
                    />
                  </label>
                  <button disabled={disabled} type="submit">적용</button>
                  <button
                    disabled={disabled}
                    onClick={() => commit(removeNavigationEnding(measures, ending.id))}
                    type="button"
                  >
                    삭제
                  </button>
                </form>
              ))}

              {pendingSections[section.id] && (
                <form
                  className="ending-editor-row"
                  onSubmit={(event) => submitPendingEnding(event, section)}
                >
                  <label>
                    <span>{getNextPass(section)}.</span>
                    <input
                      aria-label={`${getNextPass(section)}. 괄호 시작 마디`}
                      autoFocus
                      disabled={disabled}
                      inputMode="numeric"
                      min="1"
                      onChange={(event) =>
                        setPendingDrafts((current) => ({
                          ...current,
                          [section.id]: event.target.value,
                        }))
                      }
                      placeholder="시작 마디"
                      type="number"
                      value={pendingDrafts[section.id] || ''}
                    />
                  </label>
                  <button disabled={disabled} type="submit">적용</button>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      setPendingSections((current) => ({
                        ...current,
                        [section.id]: false,
                      }))
                    }
                    type="button"
                  >
                    취소
                  </button>
                </form>
              )}
            </div>

            <button
              disabled={
                disabled ||
                measures.length === 0 ||
                pendingSections[section.id]
              }
              onClick={() => beginAddingEnding(section.id)}
              type="button"
            >
              + 괄호
            </button>
          </section>
        );
      })}

      {validationMessage && (
        <small className="navigation-marker-warning" role="status">
          {validationMessage}
        </small>
      )}
    </div>
  );
}
