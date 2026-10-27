import { useLayoutEffect, useRef, useState } from 'react';
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
  /** Enter applies and Backspace cancels (the card slot's review keys); false where those keys act elsewhere. Default true. */
  reviewKeys?: boolean;
  /** Members that start unticked (Decision.startUnticked); default none. */
  startUnticked?: readonly string[];
  /** Called as the preview closes with focus inside it, so the opener can take focus back (the page would get it). */
  onCloseWithFocus?(): void;
}

/**
 * The checklist shown before "Apply all" (UI/UX research §3, GitHub's batched suggestions): every place
 * as a one-line diff, ticked unless `startUnticked` names it. The ticked ones are applied as one change, undone
 * together in the log. Any change to the text closes it (useOpenPreview), so its ticks only ever cover what it shows.
 */
export function BatchPreview({ members, replacementIndex, paraText, onApply, onCancel, reviewKeys = true, startUnticked = [], onCloseWithFocus }: Props) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  // The ticked ids, fixed when the preview opens: a member it hasn't seen starts unticked (Task F11).
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(members.filter((c) => !startUnticked.includes(c.id)).map((c) => c.id)));
  // A layout effect's cleanup runs before React removes the preview's elements, while focus can still be inside them.
  // Deliberately run once: the first onCloseWithFocus given is the one called.
  useLayoutEffect(() => {
    const element = box.current;
    return () => {
      if (element?.contains(document.activeElement)) onCloseWithFocus?.();
    };
  }, []);
  const chosen = members.filter((c) => ticked.has(c.id)).map((c) => c.id);
  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const label = chosen.length === members.length ? t.t('batch.apply', { count: chosen.length }) : t.t('batch.applySome', { chosen: chosen.length, total: members.length });
  const nothingStartsTicked = members.every((c) => startUnticked.includes(c.id));

  return (
    <div ref={box} className="batch-preview" onClick={(e) => e.stopPropagation()}>
      <p className="hint">{nothingStartsTicked ? t.t('batch.tickHint') : t.t('batch.untickHint')}</p>
      <ol className="members">
        {members.map((c) => (
          <li key={c.id}>
            <label className="member-check">
              <input type="checkbox" checked={ticked.has(c.id)} onChange={() => toggle(c.id)} />
              <Diff candidate={c} replacement={c.replacements[replacementIndex]} paraText={paraText} />
            </label>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button
          className="primary"
          data-key={reviewKeys ? 'accept' : undefined}
          aria-keyshortcuts={reviewKeys ? 'Enter' : undefined}
          disabled={chosen.length === 0}
          onClick={() => onApply(chosen)}
        >
          {label} {reviewKeys && <Kbd>Enter</Kbd>}
        </button>
        <button data-key={reviewKeys ? 'reject' : undefined} aria-keyshortcuts={reviewKeys ? 'Backspace' : undefined} onClick={onCancel}>
          {t.t('batch.cancel')} {reviewKeys && <Kbd>Backspace</Kbd>}
        </button>
      </div>
    </div>
  );
}
