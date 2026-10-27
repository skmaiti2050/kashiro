import { useState } from 'react';
import type { CheckSession } from '@/engine/session';
import { BatchPreview } from './BatchPreview';
import { useT } from './i18n/useT';
import { pendingSuggestions } from './state/aiState';
import { CATEGORIES } from './state/categories';
import { speedAdvice } from './state/helperSpeed';
import type { ControllerState, SessionController } from './state/sessionController';

interface Props {
  controller: SessionController;
  state: ControllerState;
  session: CheckSession;
  paraText: Map<number, string>;
}

/**
 * The review panel's AI group (Task 13): "Check how it reads" / "Check more sentences", the run's progress with
 * Cancel, the last notice ("No improvement suggested…"), the speed advice, and "Choose helper suggestions to
 * accept", which opens a preview with nothing ticked. Progress is not a live region: the announcer says the start and the end.
 */
export function AiGroup({ controller, state, session, paraText }: Props) {
  const t = useT();
  /** The suggestions the open Accept-all preview shows: fixed when it opens, so one arriving later is never applied unseen. */
  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const { run, checkedDocument, notice, measuring } = state.ai;
  const pending = pendingSuggestions(session);
  // Still pending among those shown: one decided or withdrawn meanwhile leaves the preview.
  const previewed = previewIds && pending.filter((c) => previewIds.includes(c.id));
  const advice = speedAdvice(state.settings);
  const progressText = run ? t.t('ai.progress', { done: run.done, total: run.total }) : '';

  return (
    <section className="ai-group" aria-labelledby="ai-group-heading">
      <h3 id="ai-group-heading">
        <span className="glyph cat-ai" aria-hidden="true">
          {CATEGORIES.ai.glyph}
        </span>{' '}
        {t.t('ai.heading')}
      </h3>
      {advice && <p className="hint warning">{t.format(advice)}</p>}
      {measuring && <p className="hint">{t.t('ai.measuring')}</p>}
      {run ? (
        <div className="ai-run">
          <div
            className="progress-bar"
            role="progressbar"
            aria-label={t.t('ai.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={run.total}
            aria-valuenow={run.done}
            aria-valuetext={progressText}
          >
            <span style={{ width: `${run.total ? (run.done / run.total) * 100 : 0}%` }} />
          </div>
          <span className="hint">{progressText}</span>
          <button onClick={() => controller.ai.cancel()}>{t.t('ai.cancel')}</button>
        </div>
      ) : (
        <div className="actions">
          {checkedDocument ? (
            <button onClick={() => controller.ai.checkMore()}>{t.t('ai.checkMore')}</button>
          ) : (
            <button onClick={() => controller.ai.checkDocument()} aria-describedby="ai-check-hint">
              {t.t('ai.checkDocument')}
            </button>
          )}
        </div>
      )}
      {!run && !checkedDocument && (
        <p id="ai-check-hint" className="hint">
          {t.t('ai.checkDocumentHint')}
        </p>
      )}
      {notice && <p className="hint">{t.format(notice)}</p>}
      {pending.length > 0 && !previewed?.length && (
        <div className="actions">
          <span className="hint">{t.t('ai.pending', { count: pending.length })}</span>
          <button onClick={() => setPreviewIds(pending.map((c) => c.id))}>{t.t('ai.chooseSuggestions', { count: pending.length })}</button>
        </div>
      )}
      {previewed && previewed.length > 0 && (
        <BatchPreview
          members={previewed}
          replacementIndex={0}
          paraText={paraText}
          // Outside the card slot, Enter and Backspace act on the current card, not on this preview.
          reviewKeys={false}
          // Like every batch card but the simple-fixes card, nothing starts ticked (owner decision 2026-10-27, Task F10).
          startUnticked={previewed.map((c) => c.id)}
          onApply={(ids) => {
            setPreviewIds(null);
            controller.ai.acceptAll(ids);
          }}
          onCancel={() => setPreviewIds(null)}
        />
      )}
    </section>
  );
}
