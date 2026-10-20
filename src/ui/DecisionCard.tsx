import { useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { WORD_REWRITE_KINDS } from '@/engine/wordFlags';
import { decisionTitle, excerpt } from './state/labels';
import type { SessionController } from './state/sessionController';

const CONTEXT_CHARS = 40;

interface Props {
  controller: SessionController;
  decision: Decision;
  candidates: Map<string, Candidate>;
  paraText: Map<number, string>;
  onSkip(): void;
  /** Shows a candidate in the document view (highlighted and scrolled into view). */
  onLocate(candidate: Candidate): void;
}

/**
 * One decision as a before/after diff. A fix offers Accept (per suggestion) / Reject; a flag with
 * nothing to apply ("This sentence is 42 words long") offers only Dismiss. Batches add Apply all /
 * See each and "Next place"; word flags add Add to dictionary / Ignore all.
 */
export function DecisionCard({ controller, decision, candidates, paraText, onSkip, onLocate }: Props) {
  const [seeEach, setSeeEach] = useState(false);
  const [place, setPlace] = useState(0);
  const members = decision.candidateIds.map((id) => candidates.get(id)!);
  const first = members[0];
  const shown = members[place % members.length];
  const isBatch = decision.kind === 'batch';
  const isWordFlag = WORD_REWRITE_KINDS.has(first.kind);
  const flagOnly = first.replacements.length === 0;

  return (
    <div className="card" title="Click to show it in the document" onClick={() => onLocate(shown)}>
      <h3 className="card-title">{decisionTitle(decision, first)}</h3>
      <p className="kind">
        <span className="kind-name">{first.kind}</span> {first.message}
      </p>
      <Diff candidate={shown} replacement={shown.replacements[0]} paraText={paraText} />
      <div className="actions" onClick={(e) => e.stopPropagation()}>
        {first.replacements.map((r, i) => (
          <button key={i} className={i === 0 ? 'primary' : ''} onClick={() => controller.accept(decision.id, i)}>
            {acceptLabel(r, first.replacements.length, isBatch, members.length)}
          </button>
        ))}
        <button className={flagOnly ? 'primary' : ''} onClick={() => controller.reject(decision.id)}>
          {flagOnly ? (isBatch ? 'Dismiss all' : 'Dismiss') : isBatch ? 'Reject all' : 'Reject'}
        </button>
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
        <button className="quiet" onClick={onSkip}>
          Skip
        </button>
      </div>
      {isBatch && seeEach && (
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

function acceptLabel(replacement: string, choices: number, isBatch: boolean, places: number): string {
  const what = replacement === '' ? 'delete' : `“${excerpt(replacement).text}”`;
  if (isBatch && choices === 1) return `Apply all (${places})`;
  if (isBatch) return `Apply ${what} to all`;
  return choices === 1 ? 'Accept' : `Use ${what}`;
}

/**
 * The text around the candidate with the original struck through and the replacement inserted. A long
 * original (a whole sentence flagged for length) is cut to its first words, with "Show more".
 */
export function Diff({ candidate, replacement, paraText }: { candidate: Candidate; replacement?: string; paraText: Map<number, string> }) {
  const [full, setFull] = useState(false);
  const text = paraText.get(candidate.paraId) ?? '';
  const { start, end } = candidate.span;
  const original = text.slice(start, end);
  const short = excerpt(original);
  const shownOriginal = full || !short.cut ? original : short.text;
  const from = Math.max(0, start - CONTEXT_CHARS);
  const to = Math.min(text.length, end + CONTEXT_CHARS);
  const isFix = replacement !== undefined;
  return (
    <p className="diff">
      {from > 0 && '…'}
      {text.slice(from, start)}
      {end > start && (isFix ? <del>{shownOriginal}</del> : <mark>{shownOriginal}</mark>)}
      {isFix && replacement !== '' && <ins>{replacement}</ins>}
      {(full || !short.cut) && text.slice(end, to)}
      {(full || !short.cut) && to < text.length && '…'}
      {short.cut && (
        <button
          className="link"
          onClick={(e) => {
            e.stopPropagation();
            setFull((v) => !v);
          }}
        >
          {full ? 'Show less' : 'Show more'}
        </button>
      )}
    </p>
  );
}
