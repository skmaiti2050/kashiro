import { useId, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';
import { readLocal, writeLocal } from './state/localMemory';

const TIPS: { title: MessageKey; text: MessageKey }[] = [
  { title: 'tour.cardsTitle', text: 'tour.cards' },
  { title: 'tour.depthTitle', text: 'tour.depth' },
  { title: 'tour.tickAllTitle', text: 'tour.tickAll' },
  { title: 'tour.logTitle', text: 'tour.log' },
];

const STORAGE_KEY = 'kashiro.tourSeen';

/** Whether the tour was shown on this PC (a per-PC convenience, like the remembered Settings tab). */
export function tourSeen(): boolean {
  // Storage can be off: no tour then, rather than one on every start.
  return readLocal(STORAGE_KEY, 'true') === 'true';
}

export const rememberTourSeen = (): void => writeLocal(STORAGE_KEY, 'true');

/**
 * The welcome tour (F23 item 7): four tips, one at a time, with Next (Done on the last) and Skip. A small modal
 * dialog: Escape or Close also ends it, and focus returns to where it was.
 */
export function WelcomeTour({ onClose }: { onClose(): void }) {
  const t = useT();
  const [at, setAt] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const textId = useId();
  const tip = TIPS[at];
  const last = at === TIPS.length - 1;

  return (
    <Dialog title={t.t('tour.title')} className="tour" describedBy={textId} initialFocus={next} onClose={onClose}>
      <p className="hint">{t.t('tour.step', { at: at + 1, count: TIPS.length })}</p>
      {/* Next keeps focus as the tip changes, so the new tip is read out from here. */}
      <div aria-live="polite">
        <h3>{t.t(tip.title)}</h3>
        <p id={textId}>{t.t(tip.text)}</p>
      </div>
      <div className="actions">
        <button ref={next} className="primary" onClick={() => (last ? onClose() : setAt(at + 1))}>
          {t.t(last ? 'tour.done' : 'tour.next')}
        </button>
        {!last && <button onClick={onClose}>{t.t('tour.skip')}</button>}
      </div>
    </Dialog>
  );
}
