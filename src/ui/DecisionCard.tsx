import { useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { WORD_REWRITE_KINDS } from '@/engine/wordFlags';
import { BatchPreview } from './BatchPreview';
import { CategoryTag } from './CategoryTag';
import { Diff } from './Diff';
import { DismissMenu } from './DismissMenu';
import { Kbd } from './Kbd';
import type { Translator } from './i18n/translator';
import { useT } from './i18n/useT';
import { categoryOf } from './state/categories';
import { DecisionTitle } from './DecisionTitle';
import { batchApplyLabel, excerpt } from './state/labels';
import { englishOnly, explanation } from './state/plainMessages';
import type { SessionController } from './state/sessionController';

interface Props {
  controller: SessionController;
  decision: Decision;
  candidates: Map<string, Candidate>;
  paraText: Map<number, string>;
  /** A member overlaps a fact-locked or tracked-change span (CheckSession.touchesLocked). */
  touchesLocked: boolean;
  /** Moves to the next card without deciding (J). */
  onNext(): void;
  /** Shows a candidate in the document view (highlighted and scrolled into view). */
  onLocate(candidate: Candidate): void;
}

/**
 * One decision as a before/after diff. A fix offers Accept (per suggestion) / Reject; a flag with
 * nothing to apply ("This sentence is 42 words long") offers only Dismiss. Batches apply after a
 * preview, plus "Next place" / "See each"; word flags add Add to dictionary / Ignore all. Rules flags
 * (not word flags, not AI rewrites) get the Dismiss ▾ scope menu. `data-key` marks the buttons the
 * review keys press (Enter: accept, Backspace: reject).
 */
export function DecisionCard({ controller, decision, candidates, paraText, touchesLocked, onNext, onLocate }: Props) {
  const t = useT();
  const [seeEach, setSeeEach] = useState(false);
  const [place, setPlace] = useState(0);
  /** The replacement index whose "Apply all" preview is open. */
  const [preview, setPreview] = useState<number | null>(null);
  const members = decision.candidateIds.map((id) => candidates.get(id)!);
  const first = members[0];
  const shown = members[place % members.length];
  const isBatch = decision.kind === 'batch';
  const isWordFlag = WORD_REWRITE_KINDS.has(first.kind);
  const flagOnly = first.replacements.length === 0;
  const category = categoryOf(first, decision.kind);
  const explained = explanation(first);
  // The engine never hides word flags, AI rewrites, hygiene fixes or flags on protected text, so don't offer it.
  const canIgnoreRule = !isWordFlag && first.source !== 'llm' && first.source !== 'hygiene' && !touchesLocked;
  const accept = (i: number) => (isBatch ? setPreview(i) : controller.accept(decision.id, i));
  const rejectLabel = flagOnly ? (isBatch ? 'card.dismissAll' : 'card.dismiss') : isBatch ? 'card.rejectAll' : 'card.reject';

  return (
    <div className="card" title={t.t('card.clickToShow')} onClick={() => onLocate(shown)}>
      <CategoryTag category={category} kind={first.kind} />
      <h3 className="card-title">
        <DecisionTitle decision={decision} candidates={candidates} />
      </h3>
      {englishOnly(explained) ? (
        // Harper's own message, not translated yet: marked English for screen readers, and said so.
        <p className="kind">
          <span lang="en">{t.format(explained)}</span>
          {t.language !== 'en' && <span className="hint"> {t.t('card.englishOnly')}</span>}
        </p>
      ) : (
        <p className="kind">{t.format(explained)}</p>
      )}
      <Diff candidate={shown} replacement={shown.replacements[0]} paraText={paraText} />
      {preview !== null ? (
        <BatchPreview
          members={members}
          replacementIndex={preview}
          paraText={paraText}
          onApply={(ids) => {
            // Unticked places stay as a smaller batch under the same id: show its card, not the preview.
            setPreview(null);
            controller.applyBatch(decision.id, ids, preview);
          }}
          onCancel={() => setPreview(null)}
        />
      ) : (
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {first.replacements.map((r, i) => (
            <button
              key={i}
              className={i === 0 ? 'primary' : ''}
              data-key={i === 0 ? 'accept' : undefined}
              aria-keyshortcuts={i === 0 ? 'Enter' : undefined}
              onClick={() => accept(i)}
            >
              {acceptLabel(t, first, r, isBatch, members.length)}
              {i === 0 && <Kbd>Enter</Kbd>}
            </button>
          ))}
          <button
            className={flagOnly ? 'primary' : ''}
            data-key={flagOnly ? 'accept reject' : 'reject'}
            aria-keyshortcuts={flagOnly ? 'Enter Backspace' : 'Backspace'}
            onClick={() => controller.reject(decision.id)}
          >
            {t.t(rejectLabel)} <Kbd>Backspace</Kbd>
          </button>
          {canIgnoreRule && (
            <DismissMenu
              kind={first.kind}
              thisOneLabel={isBatch ? t.t('card.thesePlaces', { count: members.length }) : t.t('card.thisOne')}
              onThisOne={() => controller.reject(decision.id)}
              onRule={(scope) => controller.ignoreRule(first.kind, scope)}
            />
          )}
          {isWordFlag && <button onClick={() => void controller.addToDictionary(decision.id)}>{t.t('card.addToDictionary')}</button>}
          {isWordFlag && isBatch && <button onClick={() => controller.ignoreAll(decision.id)}>{t.t('card.ignoreAll')}</button>}
          {isBatch && (
            <button
              onClick={() => {
                const next = (place + 1) % members.length;
                setPlace(next);
                onLocate(members[next]);
              }}
            >
              {t.t('card.nextPlace', { at: (place % members.length) + 1, count: members.length })}
            </button>
          )}
          {isBatch && <button onClick={() => setSeeEach((v) => !v)}>{seeEach ? t.t('card.hidePlaces') : t.t('card.seeEach')}</button>}
          <button className="quiet" aria-keyshortcuts="J" onClick={onNext}>
            {t.t('card.nextCard')} <Kbd>J</Kbd>
          </button>
        </div>
      )}
      {isBatch && seeEach && preview === null && (
        <ol className="members" onClick={(e) => e.stopPropagation()}>
          {members.map((c) => (
            <li key={c.id}>
              <div className="member-text" onClick={() => onLocate(c)}>
                <Diff candidate={c} replacement={c.replacements[0]} paraText={paraText} />
              </div>
              <div className="member-actions">
                {c.replacements.length > 0 && <button onClick={() => controller.accept(c.id, 0)}>{t.t('card.accept')}</button>}
                <button onClick={() => controller.reject(c.id)}>{c.replacements.length > 0 ? t.t('card.reject') : t.t('card.dismiss')}</button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** "Accept", "Use “its”", or for a batch its count and kind: "Apply all 12 fixes (Formatting)" (opens the preview). */
function acceptLabel(t: Translator, first: Candidate, replacement: string, isBatch: boolean, places: number): string {
  const what = replacement === '' ? t.t('card.deleteWord') : t.t('quote', { text: excerpt(replacement).text });
  const choices = first.replacements.length;
  if (isBatch && choices === 1) return batchApplyLabel(t, first.kind, places);
  if (isBatch) return t.t('card.applyTo', { what, count: places });
  return choices === 1 ? t.t('card.accept') : t.t('card.use', { what });
}
