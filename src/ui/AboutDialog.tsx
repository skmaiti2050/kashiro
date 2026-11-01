import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { useT } from './i18n/useT';
import { focusButtonAt } from './focus';
import { capabilities } from './platform/capabilities';
import { APP_VERSION, THIRD_PARTY_NOTICES, type Notice } from './notices';
import { markdownBlocks, type Inline } from './state/noticeBlocks';

/**
 * About: the version, what stays on this PC, and the third-party notices (credits and licences of the bundled
 * data, fonts and libraries), one per notice file, word for word. The notices are English, marked lang="en".
 * App.tsx loads this module on demand, so the notice texts are not in the main bundle.
 */
export function AboutDialog({ onCheckUpdates, onClose }: { onCheckUpdates: (() => void) | null; onClose(): void }) {
  const t = useT();
  return (
    <Dialog title={t.t('about.title')} className="about" onClose={onClose}>
      <p>
        {t.t('about.version', { version: APP_VERSION })}
        {capabilities.web && <> · {t.t('about.preview')}</>}
        {import.meta.env.VITE_BUILD_DATE && <> · {t.t('about.buildDate', { date: import.meta.env.VITE_BUILD_DATE })}</>}
      </p>
      {/* F23 item 4: the Releases page, in the browser, only on this click. Null where there is none (the web). */}
      {onCheckUpdates && (
        <p className="about-updates">
          <button onClick={onCheckUpdates}>{t.t('about.checkUpdates')}</button> <span className="hint">{t.t('about.checkUpdatesHint')}</span>
        </p>
      )}
      <p>{t.t('about.englishOnly')}</p>
      {!capabilities.ai &&<p>{t.t('about.webAi')}</p>}
      <p>{capabilities.web ? t.t('about.privacyWeb') : t.t('about.privacy')}</p>
      <p>{t.t('about.licence')}</p>
      <h3>{t.t('about.notices')}</h3>
      <p className="hint">{t.t('about.noticesHint')}</p>
      <Notices backLabel={t.t('about.back')} />
    </Dialog>
  );
}

/**
 * The notices as a list of names; choosing one shows only that notice, with Back (F22 item 9: no long scroll
 * through every text). Focus moves to Back on opening and to the chosen name on returning.
 */
function Notices({ backLabel }: { backLabel: string }) {
  const [shown, setShown] = useState<Notice | null>(null);
  const lastShown = useRef<Notice | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (shown) back.current?.focus();
    else if (lastShown.current) focusButtonAt(list.current, THIRD_PARTY_NOTICES.indexOf(lastShown.current));
  }, [shown]);
  const open = (notice: Notice) => {
    lastShown.current = notice;
    setShown(notice);
  };

  if (shown) {
    return (
      <>
        {/* Outside the notice: its label is in the UI language, the notices are English. */}
        <button ref={back} className="quiet notice-back" onClick={() => setShown(null)}>
          {backLabel}
        </button>
        <div className="notices" lang="en" dir="ltr">
          <h4>{shown.title}</h4>
          <NoticeText notice={shown} />
        </div>
      </>
    );
  }
  return (
    <div className="notices" lang="en" dir="ltr">
      <ul className="notice-list" ref={list}>
        {THIRD_PARTY_NOTICES.map((notice) => (
          <li key={notice.title}>
            <button className="notice-name" onClick={() => open(notice)}>
              {notice.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A Markdown notice as text (see noticeBlocks: no HTML, links as plain text); a plain-text one as it is. */
function NoticeText({ notice }: { notice: Notice }) {
  if (notice.format === 'text') return <pre className="notice-text">{notice.text}</pre>;
  return (
    <div className="notice-markdown">
      {markdownBlocks(notice.text).map((block, i) => {
        if (block.kind === 'code') return <pre key={i} className="notice-text">{block.text}</pre>;
        if (block.kind === 'paragraph') return <p key={i}>{inlineText(block.text)}</p>;
        if (block.kind === 'heading') return <NoticeHeading key={i} level={block.level}>{inlineText(block.text)}</NoticeHeading>;
        const List = block.ordered ? 'ol' : 'ul';
        return (
          <List key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{inlineText(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

/** Below the dialog's h2, the section's h3 and the notice's name (h4): a notice's "#" is an h5, deeper an h6. */
function NoticeHeading({ level, children }: { level: number; children: ReactNode }) {
  const Tag = level === 1 ? 'h5' : 'h6';
  return <Tag>{children}</Tag>;
}

function inlineText(pieces: Inline[]): ReactNode[] {
  return pieces.map((piece, i) => (piece.kind === 'code' ? <code key={i}>{piece.text}</code> : piece.kind === 'strong' ? <strong key={i}>{piece.text}</strong> : piece.text));
}
