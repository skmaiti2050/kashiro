import { useState } from 'react';
import type { Candidate } from '@/engine/types';
import { useT } from './i18n/useT';
import { excerpt } from './state/labels';

const CONTEXT_CHARS = 40;

/**
 * The text around the candidate with the original struck through and the replacement inserted. A long
 * original (a whole sentence flagged for length) is cut to its first words, with "Show more".
 */
export function Diff({ candidate, replacement, paraText }: { candidate: Candidate; replacement?: string; paraText: Map<number, string> }) {
  const t = useT();
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
      {/* The document is English whatever the UI language: screen readers read it with an English voice. */}
      <span lang="en">
        {from > 0 && '…'}
        {text.slice(from, start)}
        {end > start && (isFix ? <del>{shownOriginal}</del> : <mark>{shownOriginal}</mark>)}
        {isFix && replacement !== '' && <ins>{replacement}</ins>}
        {(full || !short.cut) && text.slice(end, to)}
        {(full || !short.cut) && to < text.length && '…'}
      </span>
      {short.cut && (
        <button
          className="link"
          onClick={(e) => {
            e.stopPropagation();
            setFull((v) => !v);
          }}
        >
          {full ? t.t('diff.showLess') : t.t('diff.showMore')}
        </button>
      )}
    </p>
  );
}
