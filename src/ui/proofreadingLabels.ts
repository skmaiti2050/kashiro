import type { EngineId } from '@/engine/languageEngine';
import type { CheckSession } from '@/engine/session';
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
  },
};

/** The proofreading engine the app always has: English. */
/**
 * The labels for this check's proofreading engine (the first one); English before a check has run.
 * Never throws (it runs while rendering): a new engine id without a row is a compile error above, and at
 * runtime an id the table lacks falls back to English.
 */
export function proofreadingLabels(session: CheckSession | null): ProofreadingLabels {
  const id = session?.proofreadingEngines()[0]?.id;
  return (id && PROOFREADING_LABELS[id as keyof typeof PROOFREADING_LABELS]) || PROOFREADING_LABELS.en;
}
