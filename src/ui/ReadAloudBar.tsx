import { useEffect, useRef } from 'react';
import { Kbd } from './Kbd';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';
import type { ReadTarget } from './state/readAloud';
import { readAloudKey } from './state/reviewKeys';
import type { ReadAloud } from './useReadAloud';

interface Props {
  readAloud: ReadAloud;
  /** The text to read for each button (the card's sentence or suggestion, or the text at the cursor), and its language. */
  textFor(target: ReadTarget): { text: string; language: string };
  /** False while a dialog is open. */
  keysEnabled: boolean;
}

const BUTTONS: { target: ReadTarget; label: MessageKey; keys: string }[] = [
  { target: 'sentence', label: 'read.sentence', keys: 'Alt+S' },
  { target: 'suggestion', label: 'read.suggestion', keys: 'Alt+R' },
  { target: 'paragraph', label: 'read.paragraph', keys: 'Alt+P' },
];

/** "Read: Sentence · Suggestion · Paragraph", with Alt+S / Alt+R / Alt+P from anywhere. */
export function ReadAloudBar({ readAloud, textFor, keysEnabled }: Props) {
  const t = useT();
  // The sentence and paragraph are the English document; a card can also be read in the UI language.
  const english = readAloud.speaks('en');
  const canRead = (target: ReadTarget) => english || (target === 'suggestion' && readAloud.speaks(t.language));
  const read = (target: ReadTarget) => {
    if (!canRead(target)) return;
    const { text, language } = textFor(target);
    readAloud.read(text, language);
  };
  const latest = useRef(read);
  useEffect(() => {
    latest.current = read;
  });
  useEffect(() => {
    if (!keysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.defaultPrevented ? null : readAloudKey(e);
      if (!target) return;
      e.preventDefault();
      latest.current(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keysEnabled]);

  return (
    <div className="read-aloud" role="group" aria-label={t.t('read.group')}>
      <span className="hint">{t.t('read.label')}</span>
      {BUTTONS.map((b) => (
        <button key={b.target} className="quiet" aria-keyshortcuts={b.keys} disabled={!canRead(b.target)} onClick={() => read(b.target)}>
          {t.t(b.label)} <Kbd>{b.keys}</Kbd>
        </button>
      ))}
      {!english && <span className="hint">{t.t('read.needsEnglishVoice')}</span>}
    </div>
  );
}
