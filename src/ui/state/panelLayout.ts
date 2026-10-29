import { readLocal, writeLocal } from './localMemory';

/**
 * The review panel's width and folded state (F23 item 3): set by the divider and the Hide button, remembered on this
 * PC (localStorage, like the change log's open state), not a setting.
 */
export const PANEL_MIN = 280;
export const PANEL_MAX = 800;
/** The width shown before the user has moved the divider and while the panel can't be measured. */
export const PANEL_DEFAULT = 380;
/** One arrow key press moves the divider this far. */
export const PANEL_STEP = 16;

const WIDTH_KEY = 'kashiro.panelWidth';
const COLLAPSED_KEY = 'kashiro.panelCollapsed';

export const clampPanelWidth = (width: number) => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width)));

/**
 * The divider's keys: an arrow moves the divider that way (towards the document widens the panel; in a right-to-left
 * layout the panel is on the left, so the arrows are mirrored), Home and End jump to the narrowest and widest.
 * Null for any other key.
 */
export function panelWidthAfterKey(key: string, width: number, dir: 'ltr' | 'rtl'): number | null {
  const widens = dir === 'ltr' ? 'ArrowLeft' : 'ArrowRight';
  const narrows = dir === 'ltr' ? 'ArrowRight' : 'ArrowLeft';
  if (key === widens) return clampPanelWidth(width + PANEL_STEP);
  if (key === narrows) return clampPanelWidth(width - PANEL_STEP);
  if (key === 'Home') return PANEL_MIN;
  if (key === 'End') return PANEL_MAX;
  return null;
}

/** The width the user last chose, or null when they never moved the divider (the CSS default applies). */
export function rememberedPanelWidth(): number | null {
  // Storage off reads null: the panel then starts at its default width, open.
  const saved = readLocal(WIDTH_KEY);
  return saved !== null && Number.isFinite(Number(saved)) ? clampPanelWidth(Number(saved)) : null;
}

export const rememberPanelWidth = (width: number) => writeLocal(WIDTH_KEY, String(width));

export const panelWasCollapsed = () => readLocal(COLLAPSED_KEY) === 'true';

export const rememberPanelCollapsed = (collapsed: boolean) => writeLocal(COLLAPSED_KEY, String(collapsed));
