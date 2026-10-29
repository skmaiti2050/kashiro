import type { PaletteCommand } from './CommandPalette';
import { BUTTONS as READ_BUTTONS } from './ReadAloudBar';
import type { PanelCommands } from './ReviewPanel';
import { SETTINGS_TABS, TAB_KEYS, type SettingsTab } from './SettingsPanel';
import type { MessageKey } from './i18n/catalogues';
import type { Translator } from './i18n/translator';
import { THEMES, type ThemeChoice } from './state/readingSettings';

/** The functions behind the app's buttons and menu items, and what can run now. */
export interface PaletteActions {
  hasDocument: boolean;
  hasSession: boolean;
  onOpen(): void;
  onPaste(): void;
  onSave(): void;
  onClose(): void;
  onSettings(tab?: SettingsTab): void;
  onDictionary(): void;
  onTheme(theme: ThemeChoice): void;
  onToggleLog(): void;
  onExportReport(): void;
  panelCollapsed: boolean;
  onTogglePanel(): void;
  onShortcuts(): void;
  onHelp(): void;
  onReportBug(): void;
  onCheckUpdates(): void;
  onAbout(): void;
  onTour(): void;
  /** Find in the document, as Ctrl+F. */
  onFind(): void;
  /** Null while word lookup is off (the entry is left out, as the ⋯ item is). */
  onLookUp: (() => void) | null;
  /** Null while AI rewrites are off or nothing is checked yet (left out, as the toolbar button is). */
  onImprove: (() => void) | null;
  /** The review panel's actions; null while it is folded. */
  panel: PanelCommands | null;
}

const THEME_KEYS: Record<ThemeChoice, MessageKey> = { system: 'reading.themeSystem', light: 'reading.themeLight', dark: 'reading.themeDark' };

/** The command palette's entries (F23 item 6), each calling the same function as its button or menu item. */
export function paletteCommands(t: Translator, a: PaletteActions): PaletteCommand[] {
  const always = true;
  const panel = a.panel;
  const reviewing = panel !== null && a.hasSession;
  return [
    { id: 'open', label: t.t('toolbar.open'), keys: 'Ctrl+O', enabled: always, run: a.onOpen },
    { id: 'paste', label: t.t('toolbar.paste'), enabled: always, run: a.onPaste },
    { id: 'save', label: t.t('save.button'), enabled: a.hasDocument && a.hasSession, run: a.onSave },
    { id: 'close', label: t.t('toolbar.close'), keys: 'Ctrl+W', enabled: a.hasDocument, run: a.onClose },
    { id: 'find', label: t.t('palette.find'), keys: 'Ctrl+F', enabled: a.hasDocument, run: a.onFind },
    { id: 'next', label: t.t('card.nextCard'), keys: 'J', enabled: reviewing, run: () => panel?.move(1) },
    { id: 'previous', label: t.t('palette.previousCard'), keys: 'K', enabled: reviewing, run: () => panel?.move(-1) },
    ...READ_BUTTONS.map((r) => ({
      id: `read-${r.target}`,
      label: t.t('palette.read', { what: t.t(r.label) }),
      keys: r.keys,
      enabled: panel?.canRead(r.target) ?? false,
      run: () => panel?.read(r.target),
    })),
    ...(a.onLookUp ? [{ id: 'lookUp', label: t.t('toolbar.lookUp'), keys: 'Ctrl+D', enabled: a.hasDocument, run: a.onLookUp }] : []),
    ...(a.onImprove ? [{ id: 'improve', label: t.t('ai.improve'), keys: 'Ctrl+I', enabled: always, run: a.onImprove }] : []),
    { id: 'panel', label: t.t(a.panelCollapsed ? 'split.show' : 'split.hide'), enabled: always, run: a.onTogglePanel },
    { id: 'log', label: t.t('palette.changeLog'), enabled: always, run: a.onToggleLog },
    { id: 'export', label: t.t('log.export'), enabled: a.hasSession, run: a.onExportReport },
    { id: 'settings', label: t.t('toolbar.settings'), keys: 'Ctrl+,', enabled: always, run: () => a.onSettings() },
    ...SETTINGS_TABS.map((tab) => ({
      id: `settings-${tab}`,
      label: t.t('palette.settingsTab', { tab: t.t(TAB_KEYS[tab]) }),
      enabled: always,
      run: () => a.onSettings(tab),
    })),
    { id: 'dictionary', label: t.t('toolbar.dictionary'), enabled: always, run: a.onDictionary },
    ...THEMES.map((theme) => ({
      id: `theme-${theme}`,
      label: t.t('palette.theme', { name: t.t(THEME_KEYS[theme]) }),
      enabled: always,
      run: () => a.onTheme(theme),
    })),
    { id: 'shortcuts', label: t.t('toolbar.shortcuts'), keys: 'F1', enabled: always, run: a.onShortcuts },
    { id: 'googleDocs', label: t.t('toolbar.googleDocs'), enabled: always, run: a.onHelp },
    { id: 'reportBug', label: t.t('toolbar.reportBug'), enabled: always, run: a.onReportBug },
    { id: 'checkUpdates', label: t.t('toolbar.checkUpdates'), enabled: always, run: a.onCheckUpdates },
    { id: 'tour', label: t.t('toolbar.tour'), enabled: always, run: a.onTour },
    { id: 'about', label: t.t('toolbar.about'), enabled: always, run: a.onAbout },
  ];
}
