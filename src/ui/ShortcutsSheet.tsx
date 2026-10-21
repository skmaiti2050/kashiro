import { Dialog } from './Dialog';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';

interface Shortcut {
  /** Key names stay as printed on the keyboard; two alternatives are joined with the language's "or". */
  keys: string | [string, string];
  action: MessageKey;
}

const ANYWHERE: Shortcut[] = [
  { keys: 'Ctrl+O', action: 'shortcuts.open' },
  { keys: 'Ctrl+V', action: 'shortcuts.paste' },
  { keys: 'Ctrl+,', action: 'shortcuts.settings' },
  { keys: ['F1', '?'], action: 'shortcuts.list' },
  { keys: 'Tab / Shift+Tab', action: 'shortcuts.tab' },
  { keys: '← / →', action: 'shortcuts.toolbar' },
  { keys: 'Escape', action: 'shortcuts.escape' },
];

const REVIEW: Shortcut[] = [
  { keys: 'Enter', action: 'shortcuts.accept' },
  { keys: ['Backspace', 'Delete'], action: 'shortcuts.reject' },
  { keys: 'J / K', action: 'shortcuts.nextPrevious' },
  { keys: 'Ctrl+.', action: 'shortcuts.cardAtCursor' },
  { keys: 'Ctrl+Z / Ctrl+Y', action: 'shortcuts.undoTyping' },
];

const READ_ALOUD: Shortcut[] = [
  { keys: 'Alt+S', action: 'shortcuts.readSentence' },
  { keys: 'Alt+R', action: 'shortcuts.readSuggestion' },
  { keys: 'Alt+P', action: 'shortcuts.readParagraph' },
];

/** The keyboard shortcuts (F1 or ?), grouped where they work. Read aloud is listed only when it is available. */
export function ShortcutsSheet({ readAloud, onClose }: { readAloud: boolean; onClose(): void }) {
  const t = useT();
  return (
    <Dialog title={t.t('shortcuts.title')} className="shortcuts" onClose={onClose}>
      <ShortcutTable caption={t.t('shortcuts.anywhere')} rows={ANYWHERE} />
      <ShortcutTable caption={t.t('shortcuts.reviewing')} rows={REVIEW} />
      {readAloud && <ShortcutTable caption={t.t('shortcuts.readAloud')} rows={READ_ALOUD} />}
    </Dialog>
  );
}

function ShortcutTable({ caption, rows }: { caption: string; rows: Shortcut[] }) {
  const t = useT();
  const keysOf = (keys: Shortcut['keys']) => (typeof keys === 'string' ? keys : t.t('shortcuts.either', { first: keys[0], second: keys[1] }));
  return (
    <table className="shortcut-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t.t('shortcuts.keys')}</th>
          <th scope="col">{t.t('shortcuts.does')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.action}>
            <th scope="row">
              <kbd>{keysOf(row.keys)}</kbd>
            </th>
            <td>{t.t(row.action)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
