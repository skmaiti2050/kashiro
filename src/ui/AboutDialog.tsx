import { Dialog } from './Dialog';
import { useT } from './i18n/useT';
import { APP_VERSION, THIRD_PARTY_NOTICES } from './notices';

/**
 * About: the version, what stays on this PC, and the third-party notices (credits and licences of the bundled
 * data, fonts and libraries), one per notice file, word for word. The notices are English, marked lang="en".
 * App.tsx loads this module on demand, so the notice texts are not in the main bundle.
 */
export function AboutDialog({ onClose }: { onClose(): void }) {
  const t = useT();
  return (
    <Dialog title={t.t('about.title')} className="about" onClose={onClose}>
      <p>{t.t('about.version', { version: APP_VERSION })}</p>
      <p>{t.t('about.privacy')}</p>
      <p>{t.t('about.licence')}</p>
      <h3>{t.t('about.notices')}</h3>
      <p className="hint">{t.t('about.noticesHint')}</p>
      <div className="notices" lang="en" dir="ltr">
        {THIRD_PARTY_NOTICES.map((notice) => (
          <details key={notice.title}>
            <summary>{notice.title}</summary>
            <pre className="notice-text">{notice.text}</pre>
          </details>
        ))}
      </div>
    </Dialog>
  );
}
