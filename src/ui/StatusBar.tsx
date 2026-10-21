import { useMemo } from 'react';
import { countWords } from '@/engine/words';
import { useT } from './i18n/useT';
import type { ControllerState } from './state/sessionController';
import { VARIANT_KEYS } from './Toolbar';

/**
 * The bottom status bar: the permanent offline promise, then word count, English variant and whether
 * the review reflects the text as it is now.
 */
export function StatusBar({ state }: { state: ControllerState }) {
  const t = useT();
  const { document, session, variantOverride, phase, checking } = state;
  const words = useMemo(() => (document ? countWords(document.text) : 0), [document?.text]);
  const busy = phase === 'checking' || checking;

  return (
    <footer className="statusbar">
      <span className="offline" title={t.t('status.offlineTitle')}>
        <span className="dot" aria-hidden="true" /> {t.t('status.offline')}
      </span>
      {document && (
        <>
          <span>{t.t('status.words', { count: words })}</span>
          {session && (
            <span>{t.t(variantOverride ? 'status.variant' : 'status.variantDetected', { variant: t.t(VARIANT_KEYS[session.variant]) })}</span>
          )}
          {/* Not a live region: it would speak after every typing pause (the panel heading announces progress). */}
          <span className={busy ? 'checking' : undefined}>{busy ? t.t('status.checking') : t.t('status.upToDate')}</span>
        </>
      )}
    </footer>
  );
}
