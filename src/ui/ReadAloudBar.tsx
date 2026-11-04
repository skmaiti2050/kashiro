import { useEffect, useRef } from 'react';
import { Kbd } from './Kbd';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';
import type { ReadTarget } from './state/readAloud';
import { readAloudControlKey, readAloudKey } from './state/reviewKeys';
import type { ReadAloud } from './useReadAloud';

interface Props {
  readAloud: ReadAloud;
  /** The text to read for each button (the card's sentence or suggestion, or the text at the cursor), and its language. */
  textFor(target: ReadTarget): { text: string; language: string };
  /** The language `textFor(target)` would give, without building the text. */
  languageFor(target: ReadTarget): string;
  /** False while a dialog is open. */
  keysEnabled: boolean;
}

/** The read-aloud buttons, also the command palette's "Read …" entries. */
export const BUTTONS: { target: ReadTarget; label: MessageKey; keys: string }[] = [
  { target: 'sentence', label: 'read.sentence', keys: 'Alt+S' },
  { target: 'suggestion', label: 'read.suggestion', keys: 'Alt+R' },
  { target: 'paragraph', label: 'read.paragraph', keys: 'Alt+P' },
];

/**
 * A card ("suggestion") is read in English or the UI language; the sentence and paragraph in the language of the
 * document's text (`textLanguage`, English unless the text is in another script).
 */
export function canReadAloud(readAloud: ReadAloud, uiLanguage: string, target: ReadTarget, textLanguage = 'en'): boolean {
  if (target === 'suggestion') return readAloud.speaks('en') || readAloud.speaks(uiLanguage);
  return readAloud.speaks(textLanguage);
}

/** Reads `target` aloud, when this PC has a voice for it: the bar's buttons and the command palette (F23 item 6). */
export function readAloudTarget(readAloud: ReadAloud, uiLanguage: string, textFor: Props['textFor'], target: ReadTarget): void {
  const { text, language } = textFor(target);
  if (!canReadAloud(readAloud, uiLanguage, target, language)) return;
  readAloud.read(text, language);
}

/** "Read: Sentence · Suggestion · Paragraph", with Alt+S / Alt+R / Alt+P from anywhere. */
export function ReadAloudBar({ readAloud, textFor, languageFor, keysEnabled }: Props) {
  const t = useT();
  // Each target's language once per render, for the buttons and the note.
  const canRead = new Map(BUTTONS.map((b) => [b.target, canReadAloud(readAloud, t.language, b.target, languageFor(b.target))]));
  // The note asks for an English voice, so it shows only for English text.
  const needsEnglishVoice = languageFor('sentence') === 'en' && !readAloud.speaks('en');
  const read = (target: ReadTarget) => readAloudTarget(readAloud, t.language, textFor, target);
  const latest = useRef(read);
  useEffect(() => {
    latest.current = read;
  });
  const latestControl = useRef(readAloud);
  useEffect(() => {
    latestControl.current = readAloud;
  });
  useEffect(() => {
    if (!keysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const control = readAloudControlKey(e);
      if (control) {
        e.preventDefault();
        latestControl.current[control]();
        return;
      }
      const target = readAloudKey(e);
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
      {/* Its own wrapping row, so a wrapped button lines up under the first one, not under the label (F21b item 2). */}
      <span className="read-aloud-buttons">
        {BUTTONS.map((b) => (
          <button key={b.target} className="quiet" aria-keyshortcuts={b.keys} disabled={!canRead.get(b.target)} onClick={() => read(b.target)}>
            {t.t(b.label)} <Kbd>{b.keys}</Kbd>
          </button>
        ))}
        {readAloud.status !== 'idle' && (
          <>
            <button className="quiet" aria-keyshortcuts="Alt+K" onClick={() => readAloud.pauseOrResume()}>
              {t.t(readAloud.status === 'paused' ? 'read.resume' : 'read.pause')} <Kbd>Alt+K</Kbd>
            </button>
            <button className="quiet" aria-keyshortcuts="Alt+X" onClick={() => readAloud.stop()}>
              {t.t('read.stop')} <Kbd>Alt+X</Kbd>
            </button>
          </>
        )}
      </span>
      {needsEnglishVoice && <span className="hint read-aloud-note">{t.t('read.needsEnglishVoice')}</span>}
    </div>
  );
}
