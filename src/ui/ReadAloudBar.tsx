import { useEffect, useRef } from 'react';
import { Kbd } from './Kbd';
import type { ReadTarget } from './state/readAloud';
import { readAloudKey } from './state/reviewKeys';
import type { ReadAloud } from './useReadAloud';

interface Props {
  readAloud: ReadAloud;
  /** The text to read for each button: the card's sentence or suggestion, or the text at the cursor. */
  textFor(target: ReadTarget): string;
  /** False while a dialog is open. */
  keysEnabled: boolean;
}

const BUTTONS: { target: ReadTarget; label: string; keys: string }[] = [
  { target: 'sentence', label: 'Sentence', keys: 'Alt+S' },
  { target: 'suggestion', label: 'Suggestion', keys: 'Alt+R' },
  { target: 'paragraph', label: 'Paragraph', keys: 'Alt+P' },
];

/** "Read: Sentence · Suggestion · Paragraph", with Alt+S / Alt+R / Alt+P from anywhere. */
export function ReadAloudBar({ readAloud, textFor, keysEnabled }: Props) {
  const read = (target: ReadTarget) => readAloud.read(textFor(target));
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
    <div className="read-aloud" role="group" aria-label="Read aloud">
      <span className="hint">Read aloud:</span>
      {BUTTONS.map((b) => (
        <button key={b.target} className="quiet" aria-keyshortcuts={b.keys} onClick={() => read(b.target)}>
          {b.label} <Kbd>{b.keys}</Kbd>
        </button>
      ))}
    </div>
  );
}
