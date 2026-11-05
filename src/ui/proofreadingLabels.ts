import type { EngineId } from '@/engine/languageEngine';
import { ENGLISH_VARIANTS } from '@/engine/englishEngine';
import type { CheckSession } from '@/engine/session';
import type { Variant } from '@/engine/types';
import type { MessageKey } from './i18n/catalogues';

/** The interface wording that names the language Kashiro proofreads. */
export interface ProofreadingLabels {
  /** The toolbar chip's name. */
  chip: MessageKey;
  /** The review panel's "Kashiro proofreads …; other scripts are not checked" line, and the About dialog's (same words, own key). */
  only: MessageKey;
  about: MessageKey;
  /** Settings › Language: the hint under the interface-language picker. */
  hint: MessageKey;
  /** The panel's all-clear line when places were set aside. */
  allClear: MessageKey;
  /** The panel's "n paragraphs / passages aren't in the proofread language" lines. */
  otherParagraphs: MessageKey;
  otherPassages: MessageKey;
  otherBoth: MessageKey;
  /** The completion announcements. */
  announceOnly: MessageKey;
  announcePassages: MessageKey;
  /** The panel's heading and the announcement when the checked text holds no letter of the proofread script. */
  nothingToCheck: MessageKey;
  announceNothing: MessageKey;
}

/**
 * Each proofreading engine's labels, by its capabilities id. The engine names no UI key (src/engine never imports
 * src/ui), so this table is the one place that maps an engine to wording. A new engine adds its row here.
 */
export const PROOFREADING_LABELS: Readonly<Record<Exclude<EngineId, 'none'>, ProofreadingLabels>> = {
  en: {
    chip: 'toolbar.english',
    only: 'panel.englishOnly',
    about: 'about.englishOnly',
    hint: 'language.hint',
    allClear: 'panel.allClearEnglish',
    otherParagraphs: 'panel.otherScript',
    otherPassages: 'panel.passages',
    otherBoth: 'panel.paragraphsAndPassages',
    announceOnly: 'announce.checkedEnglishOnly',
    announcePassages: 'announce.checkedPassages',
    nothingToCheck: 'panel.nothingToCheck',
    announceNothing: 'announce.nothingToCheck',
  },
  hi: {
    chip: 'toolbar.hindi',
    only: 'panel.hindiOnly',
    about: 'about.hindiOnly',
    hint: 'language.hintHindi',
    allClear: 'panel.allClearHindi',
    otherParagraphs: 'panel.otherScriptHindi',
    otherPassages: 'panel.passagesHindi',
    otherBoth: 'panel.paragraphsAndPassagesHindi',
    announceOnly: 'announce.checkedHindiOnly',
    announcePassages: 'announce.checkedPassagesHindi',
    nothingToCheck: 'panel.nothingToCheckHindi',
    announceNothing: 'announce.nothingToCheckHindi',
  },
};

/**
 * The spelling variants the variant picker and the status-bar variant offer: those the proofreading engine names that
 * Kashiro knows. Before a check, English's. An engine with none (Hindi) hides both. (Settings' default variant is
 * English's always: it is the default for English text.)
 */
export function pickerVariants(session: CheckSession | null): Variant[] {
  const engine = session?.proofreadingEngines()[0];
  if (!engine) return [...ENGLISH_VARIANTS];
  // English's variants are the only ones with labels (VARIANT_KEYS) and Harper dialects, so they are the known set.
  return engine.variants.filter((v): v is Variant => (ENGLISH_VARIANTS as readonly string[]).includes(v));
}

/**
 * The labels for this check's proofreading engine (one per document); English before a check has run.
 * Never throws (it runs while rendering): a new engine id without a row is a compile error above, and at
 * runtime an id the table lacks falls back to English.
 */
export function proofreadingLabels(session: CheckSession | null): ProofreadingLabels {
  const id = session?.proofreadingEngines()[0]?.id;
  return (id && PROOFREADING_LABELS[id as keyof typeof PROOFREADING_LABELS]) || PROOFREADING_LABELS.en;
}

/**
 * The read-aloud voice table: the spoken language (BCP-47) of each non-English script Kashiro can proofread or read
 * aloud, by Unicode script name. Each engine's capabilities `language` must match its script's row (readAloud.test).
 * A new language adds its row here (and its engine and labels above).
 */
export const SCRIPT_LANGUAGES: Readonly<Record<string, string>> = { Devanagari: 'hi', Bengali: 'bn' };
