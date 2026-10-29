import { useRef, useState } from 'react';
import { SIMPLE_FIXES_ID, type Decision } from '@/engine/decisions';
import type { CheckSession } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import { WORD_REWRITE_KINDS } from '@/engine/wordFlags';
import { BatchPreview } from './BatchPreview';
import { CategoryTag } from './CategoryTag';
import { Diff } from './Diff';
import { DismissMenu } from './DismissMenu';
import { Kbd } from './Kbd';
import type { Translator } from './i18n/translator';
import { useT } from './i18n/useT';
import { msg } from './i18n/message';
import { categoryOfDecision } from './state/categories';
import { DecisionTitle } from './DecisionTitle';
import { batchApplyLabel, excerpt } from './state/labels';
import { englishOnly, explanation } from './state/plainMessages';
import type { SessionController } from './state/sessionController';
import { wordsToCompare } from './state/wordLookup';
import { useOpenPreview } from './useOpenPreview';

interface Props {
  controller: SessionController;
  /** The session the card comes from, whether typed text waits for its re-check, and ControllerState.textChanges: any changing closes the preview. */
  session: CheckSession;
  checking: boolean;
  textChanges: number;
  decision: Decision;
  candidates: Map<string, Candidate>;
  paraText: Map<number, string>;
  /** A member overlaps a fact-locked or tracked-change span (CheckSession.touchesLocked). */
  touchesLocked: boolean;
  /** Moves to the next card without deciding (J). */
  onNext(): void;
  /** Shows a candidate in the document view (highlighted and scrolled into view). */
  onLocate(candidate: Candidate): void;
  /** Opens the word lookup; absent while word lookup is off. */
  onLookUp?: (words: string[]) => void;
  /** "Improve this sentence" for the sentence holding `candidate`; absent while AI rewrites are off. */
  onImprove?: (candidate: Candidate) => void;
}

/**
 * One decision as a before/after diff. A fix offers Accept (per suggestion) / Reject; a flag with
 * nothing to apply ("This sentence is 42 words long") offers only Dismiss. Batches apply after a
 * preview, plus "Next place" / "See each"; word flags add Add to dictionary / Ignore all. Rules flags
 * (not word flags, not AI rewrites) get the Dismiss ▾ scope menu. `data-key` marks the buttons the
 * review keys press (Enter: accept, Backspace: reject).
 */
export function DecisionCard({ controller, session, checking, textChanges, decision, candidates, paraText, touchesLocked, onNext, onLocate, onLookUp, onImprove }: Props) {
  const t = useT();
  const [seeEach, setSeeEach] = useState(false);
  const [place, setPlace] = useState(0);
  /** Each fix's button, by replacement index: the one that opened the preview takes focus back when it closes. */
  const openers = useRef<(HTMLButtonElement | null)[]>([]);
  // The replacement index the open preview applies; any change to the text or a re-check closes it (useOpenPreview).
  const openPreview = useOpenPreview<number>(session, checking, textChanges, (replacement) => openers.current[replacement]?.focus());
  const preview = openPreview.shown;
  const members = decision.candidateIds.map((id) => candidates.get(id)!);
  const first = members[0];
  const shown = members[place % members.length];
  const isBatch = decision.kind === 'batch';
  // The simple-fixes card mixes kinds and words: the first member's word or rule is not the card's (Task F4).
  const isSimpleFixes = decision.id === SIMPLE_FIXES_ID;
  // Every place starts unticked (every batch card but the simple-fixes card, Task F10): the button opens a choice, not "Apply all".
  const choosesPlaces = isBatch && !isSimpleFixes && decision.startUnticked?.length === members.length;
  const isWordFlag = WORD_REWRITE_KINDS.has(first.kind) && !isSimpleFixes;
  const flagOnly = first.replacements.length === 0;
  const category = categoryOfDecision(decision, candidates);
  const explained = isSimpleFixes ? msg('explain.simpleFixes') : explanation(first);
  // The engine never hides word flags, AI rewrites, hygiene fixes or flags on protected text, so don't offer it.
  const canIgnoreRule = !isWordFlag && !isSimpleFixes && first.source !== 'llm' && first.source !== 'hygiene' && !touchesLocked;
  const accept = (i: number) => (isBatch ? openPreview.open(i) : controller.accept(decision.id, i));
  const rejectLabel = flagOnly ? (isBatch ? 'card.dismissAll' : 'card.dismiss') : isBatch ? 'card.rejectAll' : 'card.reject';
  // Only for a word: a phrase or sentence to rewrite has nothing to look up.
  const lookUpWords = onLookUp && !isSimpleFixes ? wordsToCompare(first.original, first.replacements[0]) : null;
  const isAi = first.source === 'llm';

  return (
    <div className="card" title={t.t('card.clickToShow')} onClick={() => onLocate(shown)}>
      {/* An AI card says "AI suggestion" in words, not by its colour alone. */}
      <CategoryTag category={category} kind={isAi ? undefined : first.kind} />
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
          startUnticked={decision.startUnticked}
          onApply={(ids) => {
            // Unticked places stay as a smaller batch under the same id: show its card, not the preview.
            openPreview.close();
            controller.applyBatch(decision.id, ids, preview);
          }}
          onCancel={openPreview.close}
          onCloseWithFocus={openPreview.closingWithFocus}
        />
      ) : (
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {first.replacements.map((r, i) => (
            <button
              key={i}
              ref={(element) => {
                openers.current[i] = element;
              }}
              className={i === 0 ? 'primary' : ''}
              data-key={i === 0 ? 'accept' : undefined}
              aria-keyshortcuts={i === 0 ? 'Enter' : undefined}
              onClick={() => accept(i)}
            >
              {isSimpleFixes
                ? t.t('card.reviewSimpleFixes', { count: members.length })
                : choosesPlaces
                  ? chooseLabel(t, first, r)
                  : acceptLabel(t, first, r, isBatch, members.length)}
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
          {lookUpWords && <button onClick={() => onLookUp?.(lookUpWords)}>{t.t('card.lookUp')}</button>}
          {onImprove && !isAi && <button onClick={() => onImprove(shown)}>{t.t('ai.improve')}</button>}
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

/** "Accept", "Use “its”", "Delete", or for a batch its count and kind: "Apply all 12 fixes (Formatting)" (opens the preview). */
function acceptLabel(t: Translator, first: Candidate, replacement: string, isBatch: boolean, places: number): string {
  const what = fixName(t, replacement);
  const choices = first.replacements.length;
  if (isBatch && choices === 1) return batchApplyLabel(t, first.kind, places);
  if (isBatch) return t.t('card.applyTo', { what, count: places });
  if (choices === 1) return t.t('card.accept');
  // A whole label: "Use" + "delete" reads badly, and in Hindi and Bengali it isn't a sentence.
  return replacement === '' ? t.t('card.acceptDelete') : t.t('card.use', { what });
}

/** A batch whose places all start unticked: "Choose which to fix…", or per fix "Choose where to use “receive”…" (Task F10). */
function chooseLabel(t: Translator, first: Candidate, replacement: string): string {
  if (first.replacements.length === 1) return t.t('card.chooseFixes');
  return t.t('card.chooseWhere', { what: fixName(t, replacement) });
}

/** A fix as a button names it: "“receive”", or "delete" for an empty replacement. */
function fixName(t: Translator, replacement: string): string {
  if (replacement === '') return t.t('card.deleteWord');
  // The label names the word, not the spaces the insertion carries around it (Task F21b item 1): Use “the”.
  const word = replacement.trim() === '' ? replacement : replacement.trim();
  return t.t('quote', { text: excerpt(word).text });
}
