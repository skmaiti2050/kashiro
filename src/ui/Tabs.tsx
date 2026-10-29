import { useId, type KeyboardEvent, type ReactNode } from 'react';

export interface Tab<Id extends string> {
  id: Id;
  label: string;
}

interface Props<Id extends string> {
  /** The tablist's accessible name. */
  label: string;
  tabs: Tab<Id>[];
  selected: Id;
  onSelect(id: Id): void;
  /** The selected tab's content. */
  children: ReactNode;
}

/**
 * The WAI-ARIA tabs pattern with automatic activation: Left and Right (mirrored in RTL) move and select,
 * wrapping; Home and End jump; only the selected tab is a tab stop (roving tabindex). Only the selected
 * panel is rendered.
 */
export function Tabs<Id extends string>({ label, tabs, selected, onSelect, children }: Props<Id>) {
  const baseId = useId();
  const tabId = (id: Id) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  const select = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    onSelect(next.id);
    // The tab exists already (every tab is always rendered), so it can take focus now.
    document.getElementById(tabId(next.id))?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((tab) => tab.id === selected);
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === forward) select(at + 1);
    else if (e.key === back) select(at - 1);
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(tabs.length - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <div className="tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const isSelected = tab.id === selected;
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              role="tab"
              type="button"
              aria-selected={isSelected}
              aria-controls={isSelected ? panelId : undefined}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="tabpanel" role="tabpanel" id={panelId} aria-labelledby={tabId(selected)} tabIndex={0}>
        {children}
      </div>
    </>
  );
}
