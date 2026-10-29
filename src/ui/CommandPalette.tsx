import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from './Dialog';
import { Kbd } from './Kbd';
import { useT } from './i18n/useT';

/** One action of the palette: the same function its button or menu item calls. */
export interface PaletteCommand {
  id: string;
  label: string;
  /** The key hint ("Ctrl+O"). */
  keys?: string;
  /** False: shown, but can't run now (Save with nothing open). */
  enabled: boolean;
  run(): void;
}

/** Every word typed appears in the label, in any order, ignoring case ("set read" finds "Settings: Reading"). */
function matches(command: PaletteCommand, query: string): boolean {
  const label = command.label.toLocaleLowerCase();
  return query.toLocaleLowerCase().split(/\s+/).every((word) => label.includes(word));
}

interface Props {
  commands: PaletteCommand[];
  /** Runs an enabled command; the app closes the palette first. */
  onRun(command: PaletteCommand): void;
  onClose(): void;
}

/**
 * Ctrl+K (F23 item 6): a modal dialog with a combobox that filters a listbox of the app's actions (the WAI-ARIA
 * combobox pattern with aria-activedescendant: focus stays in the box). Up and Down move, Enter or a click runs,
 * Escape closes and focus returns to where it was (Dialog).
 */
export function CommandPalette({ commands, onRun, onClose }: Props) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const shown = commands.filter((c) => matches(c, query.trim()));
  const active = shown.find((c) => c.id === activeId) ?? shown.find((c) => c.enabled) ?? shown[0];
  const optionId = (c: PaletteCommand) => `${listId}-${c.id}`;
  // The active entry stays in view as the arrows move it through a long list.
  const activeOption = active ? optionId(active) : undefined;
  useEffect(() => {
    if (activeOption) document.getElementById(activeOption)?.scrollIntoView({ block: 'nearest' });
  }, [activeOption]);

  const run = (command: PaletteCommand | undefined) => {
    if (command?.enabled) onRun(command);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run(active);
      return;
    }
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || shown.length === 0) return;
    e.preventDefault();
    const at = active ? shown.indexOf(active) : -1;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    setActiveId(shown[(at + step + shown.length) % shown.length].id);
  };

  return (
    <Dialog title={t.t('palette.title')} className="palette" initialFocus={input} onClose={onClose}>
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={t.t('palette.search')}
        placeholder={t.t('palette.search')}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveId(null);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label={t.t('palette.title')} className="palette-list">
        {shown.map((c) => (
          <li
            key={c.id}
            id={optionId(c)}
            role="option"
            aria-selected={c === active}
            aria-disabled={!c.enabled || undefined}
            // Keeps focus in the box: a click only runs the entry.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(c)}
          >
            <span className="palette-label">{c.label}</span>
            {c.keys && <Kbd>{c.keys}</Kbd>}
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="hint">{t.t('palette.noMatch')}</p>}
    </Dialog>
  );
}
