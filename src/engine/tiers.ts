import type { Candidate, Span, Tier, Variant } from './types';
import type { Preset } from './presets';
import { followsAbbreviation, overlapsLocked } from './factLock';
import { isIdentifierFlag, isSlipFix, UPPER_START, WORD_REWRITE_KINDS } from './wordFlags';

// Public paths stay `engine/tiers`; the implementations live next to their own helpers.
export { buildDecisions, foldsUnderMore, type Decision } from './decisions';
export { findContractions } from './contractions';

export interface TierContext {
  /** paraId → fact-locked spans (findLockedSpans + adapter Paragraph.locked). */
  locked: Map<number, Span[]>;
  /** Lowercased words in the document's own spelling variant (never auto-converted). */
  variantWords: Set<string>;
  preset: Preset;
  /** Keyed by candidate kind. */
  userTierOverrides?: Partial<Record<string, Tier>>;
  /** paraId → paragraph text, for context-dependent safety rules. */
  paraText?: Map<number, string>;
  /** The document's spelling variant (some suggestions are wrong for some variants). */
  variant?: Variant;
}

const SAFE_RULE_KINDS = new Set(['Spelling', 'Typo', 'Repetition', 'Punctuation', 'Capitalization', 'Formatting']);

/** Function words (pronouns, articles, auxiliaries, prepositions…). After one, an a/an swap is likely the wrong fix ("an there was" is a typo of "and there was"); the LLM guard ignores them when comparing content words. */
export const FUNCTION_WORDS = new Set(
  (
    'i you he she it we they me him her us them my your his its our their mine yours ours theirs ' +
    'this that these those who whom whose what which when where why how there here ' +
    'and or but nor so yet if because as than then while although though unless whether ' +
    'a an the some any every each no all both either neither much many few more most other another such ' +
    'is are was were be been being am do does did done have has had will would shall should can could may might must ' +
    'not of in on at to for with by from into onto upon about over under ' +
    'now also just only very still even never always often soon too'
  ).split(' '),
);

/** The word right after an article, e.g. "apple" in "a apple fell". */
const NEXT_WORD = /^\s+([\p{L}\p{N}'’-]+)/u;
/** A lowercase word without apostrophes ("apple", "well-known"; not "isn't", "Rao", "8"). */
const LOWERCASE_PLAIN_WORD = /^\p{Ll}[\p{Ll}-]*$/u;

/**
 * a ↔ an, only when the next word is a lowercase content word ("a apple"). Before a function word,
 * a contraction, punctuation, the end of the text, a capitalised name, an acronym or a number the
 * "fix" is often wrong ("an they" means "and they"), so it is not an article swap for safety purposes.
 */
function isArticleSwap(c: Candidate, text: string | undefined): boolean {
  if (c.kind !== 'Miscellaneous' || c.replacements.length !== 1 || text === undefined) return false;
  const o = c.original.toLowerCase();
  const r = c.replacements[0].toLowerCase();
  if (!((o === 'a' && r === 'an') || (o === 'an' && r === 'a'))) return false;
  const next = NEXT_WORD.exec(text.slice(c.span.end))?.[1];
  if (!next || !LOWERCASE_PLAIN_WORD.test(next)) return false;
  return !FUNCTION_WORDS.has(next);
}

/** Harper asks for the Oxford comma in every variant; British and Indian English usually omit it. */
function isUnwantedOxfordComma(c: Candidate, variant: Variant | undefined): boolean {
  return (
    (variant === 'British' || variant === 'Indian') &&
    c.kind === 'Style' &&
    c.message.startsWith('An Oxford comma is necessary')
  );
}

/** Harper's title-case advice for headings is a house-style choice (spec §2: don't nag bloggers about it). */
const HEADING_TITLE_CASE = 'Try to use title case in headings.';

function baseTier(c: Candidate, ctx: TierContext): Tier {
  const { preset } = ctx;
  if (c.kind === 'Capitalization' && c.message === HEADING_TITLE_CASE) return 'hidden';
  if (isUnwantedOxfordComma(c, ctx.variant)) return 'hidden';
  if (preset.hiddenKinds.includes(c.kind)) return 'hidden';
  if (preset.reviewKinds.includes(c.kind)) return 'review';

  const safeKind =
    c.source === 'hygiene' ||
    (c.source === 'rules' && (SAFE_RULE_KINDS.has(c.kind) || isArticleSwap(c, ctx.paraText?.get(c.paraId))));
  return safeKind ? 'safe' : 'review';
}

/**
 * Risk tier for one candidate (spec §5). User overrides (by kind) win over the
 * fixed rules and the preset, but nothing becomes safe if it is LLM output, touches
 * a fact-locked span, lacks exactly one replacement, is a Spelling/Typo fix of a word starting
 * with a capital (names, acronyms) or more than one letter away (see isSlipFix), or is a word
 * of the document's variant. A Spelling/Typo flag of an identifier ("q2", "mp4") is always hidden.
 */
export function tierOf(c: Candidate, ctx: TierContext): Tier {
  if (isIdentifierFlag(c)) return 'hidden';
  const override = ctx.userTierOverrides?.[c.kind];
  const tier = override ?? baseTier(c, ctx);
  if (tier !== 'safe') return tier;
  if (c.source === 'llm') return 'review';
  if (c.replacements.length !== 1) return 'review';
  if (WORD_REWRITE_KINDS.has(c.kind) && (UPPER_START.test(c.original) || !isSlipFix(c))) return 'review';
  // "Mr. and Mrs. Rao": the linter reads the abbreviation's period as a sentence end.
  const text = ctx.paraText?.get(c.paraId);
  if (c.kind === 'Capitalization' && text !== undefined && followsAbbreviation(text, c.span.start)) return 'review';
  if (ctx.variantWords.has(c.original.toLowerCase())) return 'review';
  if (overlapsLocked(c, ctx.locked.get(c.paraId))) return 'review';
  return 'safe';
}
