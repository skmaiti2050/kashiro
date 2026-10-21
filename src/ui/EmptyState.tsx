import { Kbd } from './Kbd';
import { useT } from './i18n/useT';

interface Props {
  onOpen(): void;
  onPaste(): void;
  onSample(): void;
}

/** The document pane before anything is open: the two ways in, the privacy promise, and a sample to try. */
export function EmptyState({ onOpen, onPaste, onSample }: Props) {
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
        <p className="privacy">{t.t('empty.privacy')}</p>
        <button className="link" onClick={onSample}>
          {t.t('empty.sample')}
        </button>
      </div>
    </section>
  );
}
