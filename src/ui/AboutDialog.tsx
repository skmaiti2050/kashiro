import type { ReactNode } from 'react';
import { Dialog } from './Dialog';
import { useT } from './i18n/useT';
import { APP_VERSION, THIRD_PARTY_NOTICES, type Notice } from './notices';
import { markdownBlocks, type Inline } from './state/noticeBlocks';

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
            <NoticeText notice={notice} />
          </details>
        ))}
      </div>
    </Dialog>
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

/** Below the dialog's own h2 and the section's h3: a notice's "#" is an h4, "##" an h5, deeper an h6. */
function NoticeHeading({ level, children }: { level: number; children: ReactNode }) {
  const Tag = level === 1 ? 'h4' : level === 2 ? 'h5' : 'h6';
  return <Tag>{children}</Tag>;
}

function inlineText(pieces: Inline[]): ReactNode[] {
  return pieces.map((piece, i) => (piece.kind === 'code' ? <code key={i}>{piece.text}</code> : piece.kind === 'strong' ? <strong key={i}>{piece.text}</strong> : piece.text));
}
