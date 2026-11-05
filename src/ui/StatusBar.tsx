import { useMemo } from 'react';
import { countWords } from '@/engine/words';
import type { MessageKey } from './i18n/catalogues';
import { capabilities } from './platform/capabilities';
import { pickerVariants } from './proofreadingLabels';
import { useT } from './i18n/useT';
import type { ControllerState } from './state/sessionController';
import { VARIANT_KEYS } from './Toolbar';

/** "Indian English", "… (default)" when the text's spelling did not choose it, or "… (detected)". */
function variantKey(picked: boolean, fromFallback: boolean): MessageKey {
  if (picked) return 'status.variant';
  return fromFallback ? 'status.variantDefault' : 'status.variantDetected';
}

/**
 * The bottom status bar: the permanent offline promise, "Preview" and the build date on the web, then word count, English variant and whether
 * the review reflects the text as it is now.
 */
export function StatusBar({ state }: { state: ControllerState }) {
  const t = useT();
  const { document, session, variantOverride, phase, checking } = state;
  const words = useMemo(() => (document ? countWords(document.text) : 0), [document?.text]);
  const busy = phase === 'checking' || checking;
  // Set by scripts/build-web.ts; a development server has none.
  const buildDate = import.meta.env.VITE_BUILD_DATE;

  return (
    <footer className="statusbar">
      <span className="offline" title={t.t(capabilities.web ? 'status.offlineTitleWeb' : 'status.offlineTitle')}>
        <span className="dot" aria-hidden="true" /> {t.t(capabilities.web ? 'status.offlineWeb' : 'status.offline')}
      </span>
      {capabilities.web && <span>{buildDate ? t.t('status.preview', { date: buildDate }) : t.t('about.preview')}</span>}
      {document && (
        <>
          <span>{t.t('status.words', { count: words })}</span>
          {session && pickerVariants(session).length > 0 && <span>{t.t(variantKey(variantOverride !== null, session.variantFromFallback), { variant: t.t(VARIANT_KEYS[session.variant]) })}</span>}
          {/* Not a live region: it would speak after every typing pause (the panel heading announces progress). */}
          <span className={busy ? 'checking' : undefined}>{busy ? t.t('status.checking') : t.t('status.upToDate')}</span>
        </>
      )}
    </footer>
  );
}
