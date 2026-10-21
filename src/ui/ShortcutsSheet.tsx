import { Dialog } from './Dialog';

interface Shortcut {
  keys: string;
  action: string;
}

const ANYWHERE: Shortcut[] = [
  { keys: 'Ctrl+O', action: 'Open a file' },
  { keys: 'Ctrl+V', action: 'Paste text (on the start screen)' },
  { keys: 'Ctrl+,', action: 'Settings' },
  { keys: 'F1 or ?', action: 'This list of shortcuts' },
  { keys: 'Tab / Shift+Tab', action: 'Move between controls' },
  { keys: '← / →', action: 'Move along the toolbar' },
  { keys: 'Escape', action: 'Close a menu or dialog; stop reading aloud' },
];

const REVIEW: Shortcut[] = [
  { keys: 'Enter', action: 'Accept the card (or add its words)' },
  { keys: 'Backspace or Delete', action: 'Reject or dismiss the card' },
  { keys: 'J / K', action: 'Next / previous card' },
  { keys: 'Ctrl+.', action: 'In the text: show the card for the underline at the cursor' },
  { keys: 'Ctrl+Z / Ctrl+Y', action: 'In the text: undo / redo typing' },
];

const READ_ALOUD: Shortcut[] = [
  { keys: 'Alt+S', action: 'Read the sentence' },
  { keys: 'Alt+R', action: 'Read the suggestion' },
  { keys: 'Alt+P', action: 'Read the paragraph' },
];

/** The keyboard shortcuts (F1 or ?), grouped where they work. Read aloud is listed only when it is available. */
export function ShortcutsSheet({ readAloud, onClose }: { readAloud: boolean; onClose(): void }) {
  return (
    <Dialog title="Keyboard shortcuts" className="shortcuts" onClose={onClose}>
      <ShortcutTable caption="Anywhere" rows={ANYWHERE} />
      <ShortcutTable caption="Reviewing (in the review panel, or a read-only document)" rows={REVIEW} />
      {readAloud && <ShortcutTable caption="Read aloud (the card's text, or at the cursor while typing)" rows={READ_ALOUD} />}
    </Dialog>
  );
}

function ShortcutTable({ caption, rows }: { caption: string; rows: Shortcut[] }) {
  return (
    <table className="shortcut-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Keys</th>
          <th scope="col">Does</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.keys}>
            <th scope="row">
              <kbd>{row.keys}</kbd>
            </th>
            <td>{row.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
