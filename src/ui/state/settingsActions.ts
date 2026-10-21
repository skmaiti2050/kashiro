import type { ReviewDepth } from '@/engine/depth';
import type { ModuleSwitches } from '@/engine/modules';
import type { PresetId } from '@/engine/presets';
import type { CheckSession } from '@/engine/session';
import type { Variant } from '@/engine/types';
import type { Settings } from './settings';
import type { ControllerState } from './sessionController';

/** What the settings and dictionary actions need from the controller. */
export interface SettingsHost {
  state(): ControllerState;
  set(patch: Partial<ControllerState>): void;
  /** Shows the new settings and saves them (a failed save is shown, not thrown). */
  storeSettings(settings: Settings): void;
  /** One decision made (the progress header's count), shown together with `patch`. */
  decisionMade(patch?: Partial<ControllerState>): void;
  /** Like a rejection, it is lost if the document is closed unsaved. */
  markUnsaved(): void;
  /** The next check builds a new linter. */
  dropLinter(): void;
  /** Re-checks the open document, keeping the decisions on unchanged paragraphs. */
  recheck(): Promise<void>;
  /** The module switches changed: re-checks the open document and drops what switched-off modules hold. */
  modulesChanged(): Promise<void>;
}

/** The settings changeSettings takes. */
export type SettingsPatch = Partial<Pick<Settings, 'saveMode' | 'overwrite' | 'fallbackVariant' | 'tierOverrides' | 'termMinRepeats'>>;

export function updateSettings(host: SettingsHost, patch: Partial<Settings>): void {
  host.storeSettings({ ...host.state().settings, ...patch });
}

/**
 * Dismiss › "All <kind> suggestions in this document" or "everywhere": hides every flag of `kind` (never
 * word flags, LLM, hygiene or fact-locked ones, see the engine's isIgnoredRule). "Everywhere" is saved and
 * listed in Settings. Dismissing a kind already dismissed (here or everywhere) changes nothing.
 */
export function ignoreRule(host: SettingsHost, kind: string, scope: 'document' | 'everywhere'): void {
  const { settings, documentIgnoredRules } = host.state();
  if (settings.ignoredRules.includes(kind) || (scope === 'document' && documentIgnoredRules.includes(kind))) return;
  if (scope === 'everywhere') {
    updateSettings(host, { ignoredRules: [...settings.ignoredRules, kind] });
    host.decisionMade();
  } else {
    host.markUnsaved();
    host.decisionMade({ documentIgnoredRules: [...documentIgnoredRules, kind] });
  }
  void host.recheck();
}

/** Settings › Ignored rules › Restore. */
export function restoreRule(host: SettingsHost, kind: string): void {
  updateSettings(host, { ignoredRules: host.state().settings.ignoredRules.filter((k) => k !== kind) });
  void host.recheck();
}

/** Review depth for `preset`, saved per preset; the current preset's applies at once. */
export function setDepth(host: SettingsHost, depth: ReviewDepth, preset: PresetId): void {
  const { settings, session } = host.state();
  if (preset === settings.preset) session?.setDepth(depth);
  updateSettings(host, { depthByPreset: { ...settings.depthByPreset, [preset]: depth } });
}

export function setPreset(host: SettingsHost, preset: PresetId): void {
  updateSettings(host, { preset });
  void host.recheck();
}

/** null goes back to the detected variant. */
export function setVariant(host: SettingsHost, variant: Variant | null): void {
  host.set({ variantOverride: variant });
  void host.recheck();
}

/**
 * Settings that need no new check (save mode, overwrite) or that do (auto-apply kinds, default variant,
 * terms repeat count).
 */
export function changeSettings(host: SettingsHost, patch: SettingsPatch): void {
  updateSettings(host, patch);
  if (patch.tierOverrides || patch.fallbackVariant || patch.termMinRepeats) void host.recheck();
}

/**
 * A card or dictionary action (`change`): one decision made, and the words it added join the saved personal
 * dictionary. A failure is shown, not thrown.
 */
export async function addWords(host: SettingsHost, change: (s: CheckSession) => Promise<void>): Promise<void> {
  const session = host.state().session;
  if (!session) return;
  try {
    await change(session);
  } catch (e) {
    host.set({ error: e instanceof Error ? e.message : String(e) });
    return;
  }
  host.markUnsaved();
  host.decisionMade();
  const { dictionary } = host.state().settings;
  const known = new Set(dictionary);
  updateSettings(host, { dictionary: [...dictionary, ...session.addedWords().filter((w) => !known.has(w))] });
}

/** Settings › Modules: one switch, for the current goal when it has its own modules, else for every goal. */
export function setModule(host: SettingsHost, name: keyof ModuleSwitches, on: boolean): void {
  const { settings } = host.state();
  const own = settings.modulesByPreset[settings.preset];
  if (own) {
    updateSettings(host, { modulesByPreset: { ...settings.modulesByPreset, [settings.preset]: { ...own, [name]: on } } });
  } else {
    updateSettings(host, { modules: { ...settings.modules, [name]: on } });
  }
  void host.modulesChanged();
}

/**
 * "Use different modules for this goal": on starts `preset` with a copy of the shared switches; off drops
 * its own, so it follows the shared ones again.
 */
export function useModulesForPreset(host: SettingsHost, on: boolean, preset: PresetId): void {
  const { settings } = host.state();
  const modulesByPreset = { ...settings.modulesByPreset };
  if (on) modulesByPreset[preset] ??= { ...settings.modules };
  else delete modulesByPreset[preset];
  updateSettings(host, { modulesByPreset });
  void host.modulesChanged();
}

/** Harper can't forget an imported word, so the linter is rebuilt without it. */
export async function removeWord(host: SettingsHost, word: string): Promise<void> {
  updateSettings(host, { dictionary: host.state().settings.dictionary.filter((w) => w !== word) });
  host.dropLinter();
  await host.recheck();
}
