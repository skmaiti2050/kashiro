import type { Candidate, Paragraph, Span } from './types';
import { UPPER_START } from './wordFlags';

/**
 * Curated words easily confused in Indian English that the rules linter misses (Task U3 item 6). Each rule
 * matches only in a context that leaves little doubt, so the list stays small; the flags are always reviewed,
 * never applied automatically (see isConfusableFlag). Harper already catches "better then", "discuss about"
 * and "to loose", so those are not here.
 */
interface ConfusableRule {
  /** Matches exactly the text to replace; the context sits in lookarounds. Flags g, i and u. */
  pattern: RegExp;
  /** The replacements for the matched text, lowercase (the case of the original is kept). */
  fix: (matched: string) => string[];
  /** One line for the card, in English (the UI translates it as explain.confusable). */
  message: string;
}

/** The rules' card lines, in English (the UI shows them translated). */
export const CONFUSABLE_MESSAGES = {
  caste: 'A social group is a “caste”; “cast” is the actors in a film or play.',
  lose: 'To no longer have something is to “lose” it; “loose” means not tight.',
  onCall: 'In English you are “on a call”, not “in call”.',
  copeWith: '“Cope with” needs no “up”.',
};

/** "cast" → "caste", "casts" → "castes", "inter-cast" → "inter-caste". */
const toCaste = (matched: string) => [matched.toLowerCase().replace(/t(s?)$/, 'te$1')];
const CASTE_MESSAGE = CONFUSABLE_MESSAGES.caste;

const RULES: ConfusableRule[] = [
  // "lower cast", "upper-cast", "scheduled cast" (not "a talented cast")
  {
    pattern: /(?<=\b(?:lower|upper|higher|scheduled|backward|forward|dominant)[ -])casts?(?![\p{L}-])/giu,
    fix: toCaste,
    message: CASTE_MESSAGE,
  },
  // "cast system", "cast-based", "cast certificate"
  {
    pattern: /(?<![\p{L}-])cast(?=[ -](?:system|discrimination|certificate|based|hierarchy|census|politics|barriers?|identity)\b)/giu,
    fix: toCaste,
    message: CASTE_MESSAGE,
  },
  // "intercast", "inter-cast" (marriage)
  { pattern: /(?<![\p{L}-])inter-?cast(?![\p{L}-])/giu, fix: toCaste, message: CASTE_MESSAGE },
  // "will loose weight", "loosing money" (not "to loose": Harper flags that, nor "came loose")
  {
    pattern: /(?<![\p{L}-])(?<!\bto\s)(?:loose|loosing)(?=\s+(?:weight|money|hope|track|interest|control|patience|sleep)\b)/giu,
    fix: (matched) => [matched.toLowerCase() === 'loose' ? 'lose' : 'losing'],
    message: CONFUSABLE_MESSAGES.lose,
  },
  // "spend time in call" (not "in call centres")
  {
    pattern: /(?<![\p{L}-])in call(?![\p{L}-])(?!\s+(?:cent(?:er|re)s?|options?|logs?|queues?|recordings?|quality)\b)/giu,
    fix: () => ['on calls', 'on a call'],
    message: CONFUSABLE_MESSAGES.onCall,
  },
  // "cope up with" → "cope with"
  {
    pattern: /(?<![\p{L}-])(?:cope|copes|coped|coping) up with(?![\p{L}-])/giu,
    fix: (matched) => [matched.toLowerCase().replace(' up with', ' with')],
    message: CONFUSABLE_MESSAGES.copeWith,
  },
];

/** The engine's kind and source for these flags: ranked as word choice, judged as the engine's own rule. */
const CONFUSABLE_KIND = 'WordChoice';
const CONFUSABLE_SOURCE = 'preset';

/** "Cast" keeps its capital: "Caste". */
function keepCase(original: string, replacement: string): string {
  return UPPER_START.test(original) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

/** A flag from this rule: always reviewed, whatever the user's settings for word choice. */
export const isConfusableFlag = (c: Candidate): boolean =>
  c.kind === CONFUSABLE_KIND && c.source === CONFUSABLE_SOURCE && c.id.endsWith(':Confusable');

/** The curated confusables in `p` outside `locked` spans (quotes, code, names), in text order. */
export function findConfusables(p: Paragraph, locked: Span[] = []): Candidate[] {
  const out: Candidate[] = [];
  for (const rule of RULES) {
    for (const m of p.text.matchAll(rule.pattern)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (locked.some((s) => start < s.end && s.start < end)) continue;
      // "scheduled cast certificate": two rules, one flag.
      if (out.some((c) => c.span.start === start)) continue;
      out.push({
        id: `${p.id}:${start}:${end}:Confusable`,
        paraId: p.id,
        span: { start, end },
        original: m[0],
        replacements: rule.fix(m[0]).map((r) => keepCase(m[0], r)),
        kind: CONFUSABLE_KIND,
        message: rule.message,
        source: CONFUSABLE_SOURCE,
      });
    }
  }
  return out.sort((a, b) => a.span.start - b.span.start);
}
