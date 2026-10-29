import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { WORD_REWRITE_KINDS } from '@/engine/wordFlags';
import { acceptLabel } from './DecisionCard';
import { useT } from './i18n/useT';
import { excerpt } from './state/labels';
import type { SessionController } from './state/sessionController';
import { usePopup } from './usePopup';

/** The underlined word's box, in CSS px from the document pane's top left corner. */
export interface WordBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  controller: SessionController;
  /** A single card (never a batch: those stay in the panel). */
  decision: Decision;
  candidate: Candidate;
  at: WordBox;
  /** `returnFocus`: after an action or Escape; not when a click or focus elsewhere closed it. */
  onClose(returnFocus: boolean): void;
}

/**
 * The quick-fix popover on an underline (F23 item 5): the card's own actions next to the word, calling the card's
 * own handlers, so the text, the change log and Undo come out the same. Focus moves into it; Escape closes it.
 * Placed and kept on screen by usePopup, like the menus.
 */
export function QuickFixPopover({ controller, decision, candidate, at, onClose }: Props) {
  const t = useT();
  const anchor = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const closeQuietly = useCallback(() => onClose(false), [onClose]);
  const placement = usePopup({ open: true, close: closeQuietly, anchor, menu: box, prefer: 'end' });
  useEffect(() => {
    box.current?.querySelector('button')?.focus();
  }, []);

  const flagOnly = candidate.replacements.length === 0;
  const isWordFlag = WORD_REWRITE_KINDS.has(candidate.kind);
  const run = (action: () => void) => {
    onClose(true);
    action();
  };
  // Every key stays here: the review keys (Backspace, J) must not act on the panel's card behind it.
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key !== 'Escape') return;
    e.preventDefault();
    onClose(true);
  };

  return (
    <div ref={anchor} className="menu-anchor quick-fix-anchor" style={at} onKeyDown={onKeyDown}>
      <div ref={box} className="menu quick-fix" role="dialog" aria-label={t.t('quickFix.label', { word: excerpt(candidate.original).text })} style={placement}>
        {candidate.replacements.map((replacement, i) => (
          <button key={i} className={i === 0 ? 'primary' : ''} onClick={() => run(() => controller.accept(decision.id, i))}>
            {acceptLabel(t, candidate, replacement, false, 1)}
          </button>
        ))}
        <button className={flagOnly ? 'primary' : ''} onClick={() => run(() => controller.reject(decision.id))}>
          {t.t(flagOnly ? 'card.dismiss' : 'card.reject')}
        </button>
        {isWordFlag && <button onClick={() => run(() => void controller.addToDictionary(decision.id))}>{t.t('card.addToDictionary')}</button>}
      </div>
    </div>
  );
}
