import type { ReactNode } from 'react';
import { Dialog } from './Dialog';
import { useT } from './i18n/useT';

interface Props {
  onOpen(): void;
  onClose(): void;
}

/** Google Docs menu names stay as Google Docs shows them (bold, and English like the menus). */
const bold = (chunks: ReactNode[]) => (
  <b lang="en" dir="ltr">
    {chunks}
  </b>
);

/** How to check a Google Doc: download as .docx, fix here, upload back. Dropping a file anywhere opens it. */
export function GoogleDocsHelp({ onOpen, onClose }: Props) {
  const t = useT();
  return (
    <Dialog title={t.t('help.title')} onClose={onClose}>
      <ol className="steps">
        <li>{t.rich('help.step1', { b: bold })}</li>
        <li>{t.t('help.step2')}</li>
        <li>{t.t('help.step3')}</li>
        <li>{t.rich('help.step4', { b: bold })}</li>
      </ol>
      <div className="dropzone">
        <p>{t.t('help.drop')}</p>
        <button onClick={onOpen}>{t.t('help.open')}</button>
      </div>
    </Dialog>
  );
}
