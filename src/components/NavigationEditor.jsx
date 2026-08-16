import { useEffect, useMemo, useState } from 'react';

import { formatMeasureRange, parseMeasureRange } from '../utils/measureRange.js';
import {
  addNavigationEnding,
  addRepeatSection,
  buildNavigationModel,
  clearPointNavigationMarker,
  removeNavigationEnding,
  setPointNavigationMarker,
  updateNavigationEndingRange,
  updateRepeatSectionRange,
} from '../utils/navigationModel.js';
import {
  getNavigationEndingLabel,
} from '../utils/navigationEndings.js';
import {
  hasNavigationMarker,
  NAVIGATION_MARKER_TYPES,
} from '../utils/navigationMarkers.js';

const POINT_MARKERS = [
  { label: 'Segno', type: NAVIGATION_MARKER_TYPES.SEGNO },
  { label: 'D.S.', type: NAVIGATION_MARKER_TYPES.DAL_SEGNO },
];

function getPointMarkerNumber(measures, type) {
  const index = measures.findIndex((measure) => hasNavigationMarker(measure, type));

  return index >= 0 ? String(index + 1) : '';
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export default function NavigationEditor({
  disabled,
  measures,
  onReplaceMeasures,
}) {
  const navigationModel = useMemo(() => buildNavigationModel(measures), [measures]);
  const [endingDrafts, setEndingDrafts] = useState({});
  const [newSectionDraft, setNewSectionDraft] = useState({ end: '', start: '' });
  const [pointDrafts, setPointDrafts] = useState({});
  const [repeatDrafts, setRepeatDrafts] = useState({});
  const [validationMessage, setValidationMessage] = useState('');

  useEffect(() => {
    setRepeatDrafts(
      Object.fromEntries(
        navigationModel.repeatSections.map((section) => [
          section.id,
          {
            end: String(section.endIndex + 1),
            start: String(section.startIndex + 1),
          },
        ]),
      ),
    );
    setEndingDrafts(
      Object.fromEntries(
        navigationModel.repeatSections.flatMap((section) =>
          section.endings.map((ending) => [
            ending.id,
            formatMeasureRange(ending.startIndex + 1, ending.endIndex + 1),
          ]),
        ),
      ),
    );
    setPointDrafts(
      Object.fromEntries(
        POINT_MARKERS.map(({ type }) => [
          type,
          getPointMarkerNumber(measures, type),
        ]),
      ),
    );
  }, [measures, navigationModel.repeatSections]);

  function commit(nextMeasures) {
    if (!nextMeasures) {
      setValidationMessage('입력한 마디 번호를 확인해주세요.');
      return;
    }

    setValidationMessage('');
    onReplaceMeasures(nextMeasures);
  }

  function parsePoint(value) {
    const range = parseMeasureRange(value, measures.length);

    return range && range.start === range.end ? range.start : null;
  }

  function submitPointMarker(event, type) {
    event.preventDefault();
    const measureNumber = parsePoint(pointDrafts[type]);

    if (!measureNumber) {
      setValidationMessage('Marker에는 1부터 전체 마디 수 사이의 번호 하나를 입력하세요.');
      return;
    }

    commit(setPointNavigationMarker(measures, type, measureNumber));
  }

  function submitRepeatSection(event, section) {
    event.preventDefault();
    const draft = repeatDrafts[section.id];
    const start = parsePoint(draft?.start);
    const end = parsePoint(draft?.end);
    const overlapsAnotherSection = navigationModel.repeatSections.some(
      (candidate) =>
        candidate.id !== section.id &&
        start &&
        end &&
        rangesOverlap(start, end, candidate.startIndex + 1, candidate.endIndex + 1),
    );

    if (!start || !end || start > end || overlapsAnotherSection) {
      setValidationMessage('반복 시작/끝 번호와 다른 반복 구간의 겹침을 확인해주세요.');
      return;
    }

    commit(updateRepeatSectionRange(measures, section, start, end));
  }

  function submitNewRepeatSection(event) {
    event.preventDefault();
    const start = parsePoint(newSectionDraft.start);
    const end = parsePoint(newSectionDraft.end);
    const overlapsExistingSection = navigationModel.repeatSections.some(
      (section) =>
        start &&
        end &&
        rangesOverlap(start, end, section.startIndex + 1, section.endIndex + 1),
    );

    if (!start || !end || start > end || overlapsExistingSection) {
      setValidationMessage('새 반복 구간의 시작/끝 번호를 확인해주세요.');
      return;
    }

    setNewSectionDraft({ end: '', start: '' });
    commit(addRepeatSection(measures, start, end));
  }

  function submitEnding(event, ending) {
    event.preventDefault();
    const range = parseMeasureRange(endingDrafts[ending.id], measures.length);

    if (!range) {
      setValidationMessage('엔딩은 4 또는 5-7 형식의 유효한 범위로 입력하세요.');
      return;
    }

    commit(
      updateNavigationEndingRange(
        measures,
        ending.id,
        range.start,
        range.end,
      ),
    );
  }

  return (
    <div className="navigation-direct-editor">
      <strong>숫자로 지정</strong>

      {navigationModel.repeatSections.map((section, sectionIndex) => (
        <section className="repeat-section-editor" key={section.id}>
          <strong>반복 구간 {sectionIndex + 1}</strong>
          <form
            className="navigation-point-grid"
            onSubmit={(event) => submitRepeatSection(event, section)}
          >
            <label>
              <span title="반복 시작">||:</span>
              <input
                aria-label={`반복 구간 ${sectionIndex + 1} 반복 시작 마디`}
                disabled={disabled}
                inputMode="numeric"
                min="1"
                onChange={(event) =>
                  setRepeatDrafts((current) => ({
                    ...current,
                    [section.id]: {
                      ...current[section.id],
                      start: event.target.value,
                    },
                  }))
                }
                type="number"
                value={repeatDrafts[section.id]?.start || ''}
              />
            </label>
            <label>
              <span title="반복 끝">:||</span>
              <input
                aria-label={`반복 구간 ${sectionIndex + 1} 반복 끝 마디`}
                disabled={disabled}
                inputMode="numeric"
                min="1"
                onChange={(event) =>
                  setRepeatDrafts((current) => ({
                    ...current,
                    [section.id]: {
                      ...current[section.id],
                      end: event.target.value,
                    },
                  }))
                }
                type="number"
                value={repeatDrafts[section.id]?.end || ''}
              />
            </label>
            <button disabled={disabled} type="submit">적용</button>
          </form>

          <div className="ending-editor-list">
            <span>엔딩</span>
            {section.endings.map((ending) => (
              <form
                className="ending-editor-row"
                key={ending.id}
                onSubmit={(event) => submitEnding(event, ending)}
              >
                <label>
                  <span>{getNavigationEndingLabel(ending)}</span>
                  <input
                    aria-label={`${getNavigationEndingLabel(ending)} 엔딩 마디 범위`}
                    disabled={disabled}
                    inputMode="numeric"
                    onChange={(event) =>
                      setEndingDrafts((current) => ({
                        ...current,
                        [ending.id]: event.target.value,
                      }))
                    }
                    placeholder="5-7"
                    type="text"
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
          </div>
          <button
            disabled={disabled || measures.length === 0}
            onClick={() => commit(addNavigationEnding(measures, section))}
            type="button"
          >
            + 엔딩
          </button>
        </section>
      ))}

      <form className="repeat-section-add" onSubmit={submitNewRepeatSection}>
        <strong>반복 구간 추가</strong>
        <label>
          <span title="반복 시작">||:</span>
          <input
            aria-label="새 반복 시작 마디"
            disabled={disabled}
            inputMode="numeric"
            min="1"
            onChange={(event) =>
              setNewSectionDraft((current) => ({
                ...current,
                start: event.target.value,
              }))
            }
            type="number"
            value={newSectionDraft.start}
          />
        </label>
        <label>
          <span title="반복 끝">:||</span>
          <input
            aria-label="새 반복 끝 마디"
            disabled={disabled}
            inputMode="numeric"
            min="1"
            onChange={(event) =>
              setNewSectionDraft((current) => ({
                ...current,
                end: event.target.value,
              }))
            }
            type="number"
            value={newSectionDraft.end}
          />
        </label>
        <button disabled={disabled || measures.length === 0} type="submit">
          + 반복 구간
        </button>
      </form>

      <div className="point-marker-editor">
        {POINT_MARKERS.map(({ label, type }) => (
          <form key={type} onSubmit={(event) => submitPointMarker(event, type)}>
            <label>
              <span>{label}</span>
              <input
                aria-label={`${label} 마디`}
                disabled={disabled}
                inputMode="numeric"
                min="1"
                onChange={(event) =>
                  setPointDrafts((current) => ({
                    ...current,
                    [type]: event.target.value,
                  }))
                }
                type="number"
                value={pointDrafts[type] || ''}
              />
            </label>
            <button disabled={disabled} type="submit">적용</button>
            <button
              disabled={disabled || !pointDrafts[type]}
              onClick={() => commit(clearPointNavigationMarker(measures, type))}
              type="button"
            >
              해제
            </button>
          </form>
        ))}
      </div>

      {validationMessage && (
        <small className="navigation-marker-warning" role="status">
          {validationMessage}
        </small>
      )}
    </div>
  );
}
