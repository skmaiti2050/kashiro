import { Dialog } from './Dialog';
import { useT } from './i18n/useT';

/**
 * About in place of the real one when its chunk couldn't load: after another tab applied an update, this page's
 * old chunk is gone from the site and the cache (final review item 5). The document stays as it is.
 */
export function AboutUnavailable({ onClose }: { onClose(): void }) {
  const t = useT();
  return (
    <Dialog title={t.t('about.title')} className="about" onClose={onClose}>
      <p role="alert">{t.t('about.reloadToOpen')}</p>
    </Dialog>
  );
}
