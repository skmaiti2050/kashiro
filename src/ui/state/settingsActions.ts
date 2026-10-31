import type { ReviewDepth } from '@/engine/depth';
import type { ModuleSwitches } from '@/engine/modules';
import type { PresetId } from '@/engine/presets';
import type { CheckSession } from '@/engine/session';
import { withDuplicatesMerged, withWordAdded } from '@/engine/dictionaryWords';
import type { Variant } from '@/engine/types';
import { msg, type Message } from '../i18n/message';
import { plainError } from './errors';
import { kindKey } from './kindLabels';
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
  /** Tells the screen reader what happened and what is left ("Added to your dictionary. 3 of 5 left."). */
  announce(verb: Message): void;
  /** The next check builds a new linter. */
  dropLinter(): void;
  /** Re-checks the open document, keeping the decisions on unchanged paragraphs. */
  recheck(): Promise<void>;
  /** The module switches changed: re-checks the open document and drops what switched-off modules hold. */
  modulesChanged(): Promise<void>;
}

/** The settings changeSettings takes. */
export type SettingsPatch = Partial<Pick<Settings, 'saveMode' | 'overwrite' | 'fallbackVariant' | 'tierOverrides' | 'termMinRepeats' | 'reading' | 'uiLanguage'>>;

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
  // Announced once the re-check has hidden them, so "N left" is right.
  const verb = msg(scope === 'document' ? 'verb.dismissedInDocument' : 'verb.dismissedEverywhere', { kind: msg(kindKey(kind)) });
  void host.recheck().then(() => host.announce(verb));
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
 * Settings that need no new check (save mode, overwrite, reading and accessibility) or that do (auto-apply
 * kinds, default variant, terms repeat count).
 */
export function changeSettings(host: SettingsHost, patch: SettingsPatch): void {
  // A picked fallback variant is kept from now on; until then it follows the Windows region.
  updateSettings(host, patch.fallbackVariant ? { ...patch, fallbackVariantChosen: true } : patch);
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
    host.set({ error: plainError(e) });
    return;
  }
  host.markUnsaved();
  host.decisionMade();
  // One entry per word: a lowercase word replaces its other cases (Task F21 item G).
  const dictionary = session.addedWords().reduce(withWordAdded, host.state().settings.dictionary);
  updateSettings(host, { dictionary });
  host.announce(msg('verb.addedToDictionary'));
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

/**
 * Dictionary › Add (F22 item 1). With a document open it is a card's Add to dictionary (its flags rejected, a fix of
 * it the user applied taken back); without one the word is only saved, and the next linter is built with it.
 */
export async function addTypedWord(host: SettingsHost, word: string): Promise<void> {
  const composed = word.trim().normalize('NFC');
  if (composed === '') return;
  if (host.state().session) return addWords(host, (s) => s.addTypedWord(composed));
  updateSettings(host, { dictionary: withWordAdded(host.state().settings.dictionary, composed) });
  host.dropLinter(); // a warmed-up linter would not know the word
  host.announce(msg('verb.addedToDictionary'));
}

/** Harper can't forget an imported word, so the linter is rebuilt without it. */
export async function removeWord(host: SettingsHost, word: string): Promise<void> {
  await replaceDictionary(host, host.state().settings.dictionary.filter((w) => w !== word));
}

/** Dictionary › Merge duplicates (see withDuplicatesMerged): how many entries went. */
export async function mergeDictionaryDuplicates(host: SettingsHost): Promise<number> {
  const { dictionary, merged } = withDuplicatesMerged(host.state().settings.dictionary);
  if (merged > 0) await replaceDictionary(host, dictionary);
  return merged;
}

/**
 * Settings › Import dictionary (web): each word added with the dictionary's add rule (withWordAdded: case and NFC),
 * then the linter rebuilt and the document checked again, as when a word leaves.
 */
export async function importDictionaryWords(host: SettingsHost, words: readonly string[]): Promise<void> {
  const composed = words.map((word) => word.trim().normalize('NFC')).filter((word) => word !== '');
  const before = host.state().settings.dictionary;
  const after = composed.reduce(withWordAdded, before);
  await replaceDictionary(host, after);
  // The words actually added: ones already there, or repeated in the file, don't count (final review item 9).
  host.set({ notice: msg('notice.dictionaryImported', { count: after.length - before.length }) });
}

/** A word left the dictionary: the linter is rebuilt from the saved list and the document checked again. */
async function replaceDictionary(host: SettingsHost, dictionary: string[]): Promise<void> {
  updateSettings(host, { dictionary });
  host.dropLinter();
  await host.recheck();
}
