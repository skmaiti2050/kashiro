import { useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { WORD_REWRITE_KINDS } from '@/engine/wordFlags';
import { BatchPreview } from './BatchPreview';
import { CategoryTag } from './CategoryTag';
import { Diff } from './Diff';
import { DismissMenu } from './DismissMenu';
import { Kbd } from './Kbd';
import { categoryOf } from './state/categories';
import { batchApplyLabel, decisionTitle, excerpt } from './state/labels';
import { plainMessage } from './state/plainMessages';
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
  // The engine never hides word flags, AI rewrites, hygiene fixes or flags on protected text, so don't offer it.
  const canIgnoreRule = !isWordFlag && first.source !== 'llm' && first.source !== 'hygiene' && !touchesLocked;
  const accept = (i: number) => (isBatch ? setPreview(i) : controller.accept(decision.id, i));

  return (
    <div className="card" title="Click to show it in the document" onClick={() => onLocate(shown)}>
      <CategoryTag category={category} kind={first.kind} />
      <h3 className="card-title">{decisionTitle(decision, first)}</h3>
      <p className="kind">{plainMessage(first)}</p>
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
              {acceptLabel(first, r, isBatch, members.length)}
              {i === 0 && <Kbd>Enter</Kbd>}
            </button>
          ))}
          <button
            className={flagOnly ? 'primary' : ''}
            data-key={flagOnly ? 'accept reject' : 'reject'}
            aria-keyshortcuts={flagOnly ? 'Enter Backspace' : 'Backspace'}
            onClick={() => controller.reject(decision.id)}
          >
            {flagOnly ? (isBatch ? 'Dismiss all' : 'Dismiss') : isBatch ? 'Reject all' : 'Reject'} <Kbd>Backspace</Kbd>
          </button>
          {canIgnoreRule && (
            <DismissMenu
              kind={first.kind}
              thisOneLabel={isBatch ? `These ${members.length} places` : 'This one'}
              onThisOne={() => controller.reject(decision.id)}
              onRule={(scope) => controller.ignoreRule(first.kind, scope)}
            />
          )}
          {isWordFlag && <button onClick={() => void controller.addToDictionary(decision.id)}>Add to dictionary</button>}
          {isWordFlag && isBatch && <button onClick={() => controller.ignoreAll(decision.id)}>Ignore all</button>}
          {isBatch && (
            <button
              onClick={() => {
                const next = (place + 1) % members.length;
                setPlace(next);
                onLocate(members[next]);
              }}
            >
              Next place ({(place % members.length) + 1}/{members.length})
            </button>
          )}
          {isBatch && <button onClick={() => setSeeEach((v) => !v)}>{seeEach ? 'Hide places' : 'See each'}</button>}
          <button className="quiet" aria-keyshortcuts="J" onClick={onNext}>
            Next card <Kbd>J</Kbd>
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
                {c.replacements.length > 0 && <button onClick={() => controller.accept(c.id, 0)}>Accept</button>}
                <button onClick={() => controller.reject(c.id)}>{c.replacements.length > 0 ? 'Reject' : 'Dismiss'}</button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** "Accept", "Use “its”", or for a batch its count and kind: "Apply all 12 formatting fixes" (opens the preview). */
function acceptLabel(first: Candidate, replacement: string, isBatch: boolean, places: number): string {
  const what = replacement === '' ? 'delete' : `“${excerpt(replacement).text}”`;
  const choices = first.replacements.length;
  if (isBatch && choices === 1) return batchApplyLabel(first.kind, places);
  if (isBatch) return `Apply ${what} to all ${places}…`;
  return choices === 1 ? 'Accept' : `Use ${what}`;
}
