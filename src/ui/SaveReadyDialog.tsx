import { useRef } from 'react';
import { Dialog } from './Dialog';
import { useT } from './i18n/useT';
import type { SaveClickRequest } from './platform/files';

/**
 * "report.checked.docx is ready to save": the browser refused its save picker because the Save click was too long
 * ago, so Save here opens it from a new click, with the file already built. Escape cancels.
 */
export function SaveReadyDialog({ request, onDone }: { request: SaveClickRequest; onDone(): void }) {
  const t = useT();
  const saveButton = useRef<HTMLButtonElement>(null);
  const cancel = () => {
    request.cancel();
    onDone();
  };
  return (
    <Dialog title={t.t('save.readyToSave', { name: request.name })} role="alertdialog" initialFocus={saveButton} onClose={cancel}>
      <div className="actions end">
        <button className="quiet" onClick={cancel}>
          {t.t('save.readyCancel')}
        </button>
        <button
          ref={saveButton}
          className="primary"
          onClick={() => {
            // Inside this click: the browser opens its picker only for one.
            request.save();
            onDone();
          }}
        >
          {t.t('save.button')}
        </button>
      </div>
    </Dialog>
  );
}
