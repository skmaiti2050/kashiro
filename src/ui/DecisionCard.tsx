import { useState } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { WORD_REWRITE_KINDS } from '@/engine/wordFlags';
import type { SessionController } from './state/sessionController';

const CONTEXT_CHARS = 40;

interface Props {
  controller: SessionController;
  decision: Decision;
  candidates: Map<string, Candidate>;
  paraText: Map<number, string>;
  onSkip(): void;
}

/** One decision as a before/after diff: Accept (per suggestion) / Reject, plus batch and word actions. */
export function DecisionCard({ controller, decision, candidates, paraText, onSkip }: Props) {
  const [seeEach, setSeeEach] = useState(false);
  const members = decision.candidateIds.map((id) => candidates.get(id)!);
  const first = members[0];
  const isBatch = decision.kind === 'batch';
  const isWordFlag = WORD_REWRITE_KINDS.has(first.kind);

  return (
    <div className="card">
      <h3>{decision.label}</h3>
      <p className="kind">
        {first.kind}: {first.message}
      </p>
      <Diff candidate={first} replacement={first.replacements[0]} paraText={paraText} />
      <div className="actions">
        {first.replacements.map((r, i) => (
          <button key={i} className={i === 0 ? 'primary' : ''} onClick={() => controller.accept(decision.id, i)}>
            {acceptLabel(r, first.replacements.length, isBatch, members.length)}
          </button>
        ))}
        <button onClick={() => controller.reject(decision.id)}>{isBatch ? 'Reject all' : 'Reject'}</button>
        {isWordFlag && <button onClick={() => void controller.addToDictionary(decision.id)}>Add to dictionary</button>}
        {isWordFlag && isBatch && <button onClick={() => controller.ignoreAll(decision.id)}>Ignore all</button>}
        {isBatch && <button onClick={() => setSeeEach((v) => !v)}>{seeEach ? 'Hide places' : 'See each'}</button>}
        <button className="quiet" onClick={onSkip}>
          Skip
        </button>
      </div>
      {isBatch && seeEach && (
        <ol className="members">
          {members.map((c) => (
            <li key={c.id}>
              <Diff candidate={c} replacement={c.replacements[0]} paraText={paraText} />
              {c.replacements.length > 0 && <button onClick={() => controller.accept(c.id, 0)}>Accept</button>}
              <button onClick={() => controller.reject(c.id)}>Reject</button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function acceptLabel(replacement: string, choices: number, isBatch: boolean, places: number): string {
  const what = replacement === '' ? 'delete' : `“${replacement}”`;
  if (isBatch && choices === 1) return `Apply all (${places})`;
  if (isBatch) return `Apply ${what} to all`;
  return choices === 1 ? 'Accept' : `Use ${what}`;
}

/** The sentence around the candidate with the original struck through and the replacement inserted. */
export function Diff({ candidate, replacement, paraText }: { candidate: Candidate; replacement?: string; paraText: Map<number, string> }) {
  const text = paraText.get(candidate.paraId) ?? '';
  const { start, end } = candidate.span;
  const from = Math.max(0, start - CONTEXT_CHARS);
  const to = Math.min(text.length, end + CONTEXT_CHARS);
  return (
    <p className="diff">
      {from > 0 && '…'}
      {text.slice(from, start)}
      {end > start && <del>{text.slice(start, end)}</del>}
      {replacement !== undefined && replacement !== '' && <ins>{replacement}</ins>}
      {text.slice(end, to)}
      {to < text.length && '…'}
    </p>
  );
}
