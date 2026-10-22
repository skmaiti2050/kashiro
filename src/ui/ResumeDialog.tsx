import { useRef } from 'react';
import { Dialog } from './Dialog';
import { useT } from './i18n/useT';
import type { ResumeOffer } from './state/sessionPersistence';

interface Props {
  offer: ResumeOffer;
  onResume(): void;
  onStartFresh(): void;
  /** Escape: neither; the saved review is kept for next time. */
  onDismiss(): void;
}

/** "Resume your review? (N decisions made, M left)" when a document with a saved review is opened again. */
export function ResumeDialog({ offer, onResume, onStartFresh, onDismiss }: Props) {
  const t = useT();
  const resumeButton = useRef<HTMLButtonElement>(null);
  const title = t.t(offer.changed ? 'resume.changedTitle' : 'resume.title');

  return (
    <Dialog title={title} role="alertdialog" className="resume" describedBy="resume-text" initialFocus={resumeButton} onClose={onDismiss}>
      <div id="resume-text">
        {offer.changed && <p>{t.t('resume.changedText')}</p>}
        <p>{t.t('resume.text', { made: offer.made, left: offer.left })}</p>
      </div>
      <div className="actions end">
        <button onClick={onStartFresh}>{t.t('resume.fresh')}</button>
        <button ref={resumeButton} className="primary" onClick={onResume}>
          {t.t('resume.resume')}
        </button>
      </div>
    </Dialog>
  );
}
