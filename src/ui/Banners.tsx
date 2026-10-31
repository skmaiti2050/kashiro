import { useEffect } from 'react';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';
import type { ControllerState, SessionController } from './state/sessionController';

/** How long a notice stays before it clears on its own. */
const NOTICE_MS = 6000;

/**
 * Notices that stay until dismissed, like errors: changes left out of the saved file, settings the browser won't
 * keep, or an Apply that typing lost, must not go unseen.
 */
const LASTING_NOTICES: ReadonlySet<MessageKey> = new Set(['notice.savedUnplaced', 'notice.noStorage', 'notice.applyLostToTyping']);

/**
 * The error and notice banners. A notice ("Saved as …") clears on its own; an error, or a notice that something
 * was left undone, stays until its × is pressed.
 */
export function Banners({ controller, state }: { controller: SessionController; state: ControllerState }) {
  const t = useT();
  useEffect(() => {
    if (!state.notice || LASTING_NOTICES.has(state.notice.key)) return;
    const timer = setTimeout(() => controller.dismissNotice(), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [state.notice, controller]);

  return (
    // Live regions exist before their text arrives, so screen readers announce it. data-live-regions keeps
    // them out of a dialog's inert page (Dialog.tsx), so an error raised behind a dialog is still heard.
    <div className="banners" data-live-regions>
      <Banner role="alert" className="banner error" text={state.error && t.format(state.error)} onDismiss={() => controller.dismissError()} />
      <Banner role="status" className="banner" text={state.notice && !state.error ? t.format(state.notice) : null} onDismiss={() => controller.dismissNotice()} />
    </div>
  );
}

/**
 * An error or notice with its × (a real button: Tab reaches it, Enter or Space dismisses). The live region
 * is always there and holds only the message, so the screen reader announces the text and not the button.
 */
function Banner({ role, className, text, onDismiss }: { role: 'alert' | 'status'; className: string; text: string | null; onDismiss(): void }) {
  const t = useT();
  return (
    <div className={text ? className : undefined}>
      <div role={role}>{text && <p>{text}</p>}</div>
      {text && (
        <button className="quiet dismiss" aria-label={t.t('banner.dismiss')} title={t.t('banner.dismiss')} onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}
