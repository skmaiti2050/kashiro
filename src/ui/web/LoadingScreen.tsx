import { translatorFor } from '../i18n/translatorFor';

/**
 * The web app's first screen while Harper's wasm downloads: "Loading the proofreader… 7 MB", or an indeterminate bar
 * where the download can't be counted. Settings aren't loaded yet, so it speaks the browser's language.
 */
export function LoadingScreen({ megabytes }: { megabytes: number | null }) {
  const t = translatorFor('system');
  return (
    <main className="starting loading-screen" lang={t.language} dir={t.dir}>
      <div>
        <p>{megabytes === null ? t.t('loading.proofreader') : t.t('loading.proofreaderSize', { megabytes })}</p>
        {megabytes === null && <progress aria-label={t.t('loading.proofreader')} />}
      </div>
    </main>
  );
}
