import { Kbd } from './Kbd';
import { capabilities } from './platform/capabilities';
import { RecentReviews } from './RecentReviews';
import { useT } from './i18n/useT';
import type { RecentReview } from './state/sessionStore';

interface Props {
  onOpen(): void;
  onPaste(): void;
  onSample(): void;
  /** Saved reviews to pick up again (empty while Saved reviews is off). */
  recent: RecentReview[];
  onOpenRecent(review: RecentReview): void;
  /** Word lookup is on: the start screen says how to use it (Ctrl+D). */
  lookUp: boolean;
}

/** The document pane before anything is open: the two ways in, the privacy promise, a sample to try, and recent reviews. */
export function EmptyState({ onOpen, onPaste, onSample, recent, onOpenRecent, lookUp }: Props) {
  const t = useT();
  return (
    <section className="document empty" aria-label={t.t('empty.region')}>
      <div className="empty-state">
        <h2>{t.t('empty.title')}</h2>
        <p className="hint">{t.t('empty.hint')}</p>
        <div className="empty-actions">
          <button className="primary" aria-keyshortcuts="Control+O" onClick={onOpen}>
            {t.t('empty.open')} <Kbd>Ctrl+O</Kbd>
          </button>
          <button aria-keyshortcuts="Control+V" onClick={onPaste}>
            {t.t('empty.paste')} <Kbd>Ctrl+V</Kbd>
          </button>
        </div>
        <p className="privacy">{capabilities.web ? t.t('empty.privacyWeb') : t.t('empty.privacy')}</p>
        {lookUp && <p className="hint">{t.t('empty.lookUpHint')}</p>}
        <button className="link" onClick={onSample}>
          {t.t('empty.sample')}
        </button>
        <RecentReviews reviews={recent} onOpen={onOpenRecent} />
      </div>
    </section>
  );
}
