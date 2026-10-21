import { useState } from 'react';
import type { Candidate } from '@/engine/types';
import { Diff } from './Diff';
import { Kbd } from './Kbd';
import { useT } from './i18n/useT';

interface Props {
  members: Candidate[];
  replacementIndex: number;
  paraText: Map<number, string>;
  onApply(candidateIds: string[]): void;
  onCancel(): void;
}

/**
 * The checklist shown before "Apply all" (UI/UX research §3, GitHub's batched suggestions): every place
 * as a one-line diff, all ticked. The ticked ones are applied as one change, undone together in the log.
 */
export function BatchPreview({ members, replacementIndex, paraText, onApply, onCancel }: Props) {
  const t = useT();
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const chosen = members.filter((c) => !unticked.has(c.id)).map((c) => c.id);
  const toggle = (id: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const label = chosen.length === members.length ? t.t('batch.apply', { count: chosen.length }) : t.t('batch.applySome', { chosen: chosen.length, total: members.length });

  return (
    <div className="batch-preview" onClick={(e) => e.stopPropagation()}>
      <p className="hint">{t.t('batch.untickHint')}</p>
      <ol className="members">
        {members.map((c) => (
          <li key={c.id}>
            <label className="member-check">
              <input type="checkbox" checked={!unticked.has(c.id)} onChange={() => toggle(c.id)} />
              <Diff candidate={c} replacement={c.replacements[replacementIndex]} paraText={paraText} />
            </label>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button className="primary" data-key="accept" aria-keyshortcuts="Enter" disabled={chosen.length === 0} onClick={() => onApply(chosen)}>
          {label} <Kbd>Enter</Kbd>
        </button>
        <button data-key="reject" aria-keyshortcuts="Backspace" onClick={onCancel}>
          {t.t('batch.cancel')} <Kbd>Backspace</Kbd>
        </button>
      </div>
    </div>
  );
}
