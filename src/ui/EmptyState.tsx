import { Kbd } from './Kbd';

interface Props {
  onOpen(): void;
  onPaste(): void;
  onSample(): void;
}

/** The document pane before anything is open: the two ways in, the privacy promise, and a sample to try. */
export function EmptyState({ onOpen, onPaste, onSample }: Props) {
  return (
    <section className="document empty" aria-label="Start">
      <div className="empty-state">
        <h2>Check a document</h2>
        <p className="hint">A .docx, .txt or .md file (or drop one here), or text from anywhere.</p>
        <div className="empty-actions">
          <button className="primary" aria-keyshortcuts="Control+O" onClick={onOpen}>
            Open a file <Kbd>Ctrl+O</Kbd>
          </button>
          <button aria-keyshortcuts="Control+V" onClick={onPaste}>
            Paste text <Kbd>Ctrl+V</Kbd>
          </button>
        </div>
        <p className="privacy">Works offline. Your writing never leaves this PC.</p>
        <button className="link" onClick={onSample}>
          Try a sample paragraph
        </button>
      </div>
    </section>
  );
}
