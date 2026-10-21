import { useMemo } from 'react';
import { countWords } from '@/engine/words';
import type { ControllerState } from './state/sessionController';

/**
 * The bottom status bar: the permanent offline promise, then word count, English variant and whether
 * the review reflects the text as it is now.
 */
export function StatusBar({ state }: { state: ControllerState }) {
  const { document, session, variantOverride, phase, checking } = state;
  const words = useMemo(() => (document ? countWords(document.text) : 0), [document?.text]);
  const busy = phase === 'checking' || checking;

  return (
    <footer className="statusbar">
      <span className="offline" title="Your text is checked on this PC and never sent anywhere.">
        <span className="dot" aria-hidden="true" /> Offline · nothing leaves this PC
      </span>
      {document && (
        <>
          <span>
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
          </span>
          {session && (
            <span>
              {session.variant} English{variantOverride ? '' : ' (detected)'}
            </span>
          )}
          <span role="status" className={busy ? 'checking' : undefined}>
            {busy ? 'Checking…' : 'Up to date'}
          </span>
        </>
      )}
    </footer>
  );
}
