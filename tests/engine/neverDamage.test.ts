/**
 * Never-damage stress test (CLAUDE.md rule #1, external review #4, owner decision in Task F4): several hundred
 * generated sentences full of traps (legitimate doublings, invisible and bidi characters, list labels, acronyms,
 * names, amounts, Hindi and Bengali, quotes, URLs, code, abbreviations, slash compounds), checked under every
 * preset, with default settings and with every auto-apply setting on. Without a click the session may only:
 *   - delete an invisible character the generator planted (never a joiner Indic text needs);
 *   - change whitespace between tokens it leaves exactly as they were, away from every trap.
 * A token is a run of characters that are neither whitespace nor invisible, so a case change, "?" → ".",
 * "e-mail" → "e mail", "Don't" → "Don t" or "home ." → "home." is not spacing. Every edit must also start and
 * end on grapheme-cluster boundaries, no direction control may lose its partner (isolates included), and the
 * saved file must equal the paragraphs with the edits applied, without U+FFFD. The planted errors are still
 * found: each waits in a decision with its one right fix. The seed is fixed, so a failure is reproducible.
 * Then "Review and apply all" on the simple-fixes card with its default ticks, one click and nothing inspected,
 * is judged too (Task F5): each change starts and ends on word boundaries, keeps the case except at a sentence
 * start (never after an abbreviation's dot), swaps an article only before a lowercase dictionary word that is no
 * initialism, and leaves the layout of the traps alone; the planted errors are still fixed by it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type Outcome } from '@/engine/session';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import { PRESETS, type PresetId } from '@/engine/presets';
import type { Tier, Variant } from '@/engine/types';
import { markdownAdapter, plaintextAdapter } from '@/formats/text';
import { AUTO_APPLY_KINDS } from '@/ui/state/settings';
import { acceptAllRules } from '../../cli/run';
import { sentenceCount, stressDocument, type StressParagraph } from './neverDamageCorpus';

const SEED = 20261024;
const PARAGRAPHS = 80;

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

/** Every kind the Settings panel offers, switched on. */
const EVERYTHING_AUTO: Partial<Record<string, Tier>> = Object.fromEntries(AUTO_APPLY_KINDS.map((k) => [k, 'safe']));

/** Invisible, direction and variation characters: removed before tokens are compared, and printed as <U+…>. */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const WHITESPACE = /\s+/u;

/** The text's tokens: maximal runs of characters that are neither whitespace nor invisible. */
function tokens(text: string): string[] {
  return text.replace(INVISIBLE, '').split(WHITESPACE).filter((t) => t !== '');
}

const sameTokens = (a: string, b: string) => {
  const x = tokens(a);
  const y = tokens(b);
  return x.length === y.length && x.every((t, i) => t === y[i]);
};

/**
 * True when replacing `span` of `text` changes only whitespace between tokens it leaves exactly as they were:
 * "  " → " ". Case, punctuation, hyphens, apostrophes and slashes are all part of a token, so "?" → ".",
 * "e-mail" → "e mail" and "to to's" → "toto's" are not spacing (F3 re-review 2, I-5). An invisible character
 * may go only when it was planted (`junk`): a joiner or direction mark the text needs is not spacing (F4
 * re-review 3, M-1).
 */
function isSpacingOnly(text: string, span: { start: number; end: number }, replacement: string, junk: ReadonlySet<number> = new Set()): boolean {
  if (!sameTokens(text, text.slice(0, span.start) + replacement + text.slice(span.end))) return false;
  let kept = '';
  for (let i = span.start; i < span.end; i++) if (!junk.has(i) && /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(text[i])) kept += text[i];
  return (replacement.match(INVISIBLE) ?? []).join('') === kept;
}

/**
 * True when `after` holds the paragraph's invisible characters in order, less only planted ones: none added,
 * swapped, or removed that the text needs (F4 re-review 3, M-1).
 */
function keepsUnplantedInvisibles(p: StressParagraph, after: string): boolean {
  const kept = after.match(INVISIBLE) ?? [];
  let k = 0;
  let i = 0;
  for (const ch of p.text) {
    if (ch.match(INVISIBLE)) {
      if (kept[k] === ch) k++;
      else if (!p.junk.has(i)) return false;
    }
    i += ch.length;
  }
  return k === kept.length;
}

/** Embeddings and overrides (U+202A, U+202B, U+202D, U+202E), their end U+202C, isolates U+2066–2068 and their end U+2069. */
const DIRECTION_OPEN = /[\u{202A}\u{202B}\u{202D}\u{202E}]/u;
const DIRECTION_END = '\u{202C}';
const ISOLATE_OPEN = /[\u{2066}\u{2067}\u{2068}]/u;
const ISOLATE_END = '\u{2069}';

/**
 * Direction controls without a partner, as UAX #9 matches them: an embedding or isolate never ended, a U+202C
 * with no embedding open inside the current isolate, or a U+2069 with no isolate open. A U+2069 also ends every
 * embedding opened inside its isolate (F3 re-review 2, I-2).
 */
function unpairedDirectionControls(text: string): number {
  const open: ('embedding' | 'isolate')[] = [];
  let unpaired = 0;
  for (const ch of text) {
    if (DIRECTION_OPEN.test(ch)) open.push('embedding');
    else if (ISOLATE_OPEN.test(ch)) open.push('isolate');
    else if (ch === DIRECTION_END) {
      if (open.at(-1) === 'embedding') open.pop();
      else unpaired++;
    } else if (ch === ISOLATE_END) {
      if (!open.includes('isolate')) unpaired++;
      else while (open.pop() !== 'isolate');
    }
  }
  return unpaired + open.length;
}

/** A paragraph whose saved text has a direction control its original paired: half a pair was deleted (F3 re-review, D3). */
function splitDirectionPairs(session: CheckSession, document: StressParagraph[]): string[] {
  return document.flatMap((p, id) =>
    unpairedDirectionControls(session.outputText(id)) > unpairedDirectionControls(p.text)
      ? [`¶${id} "${shown(session.outputText(id))}": half of a direction-control pair was deleted`]
      : [],
  );
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

function boundaries(text: string): Set<number> {
  const out = new Set([text.length]);
  for (const g of graphemes.segment(text)) out.add(g.index);
  return out;
}

const touches = (span: { start: number; end: number }, trap: { start: number; end: number }) =>
  span.start === span.end ? trap.start < span.start && span.start < trap.end : span.start < trap.end && trap.start < span.end;

type Approved = 'invisible' | 'spacing';

/** The approved-list entry this change made without a click falls under, or why it falls under none. */
function judge(o: Outcome, p: StressParagraph): { approved: Approved } | { problem: string } {
  const { span, original } = o.candidate;
  const replacement = o.replacement ?? '';
  if (p.text.slice(span.start, span.end) !== original) return { problem: 'its offsets do not match the paragraph' };
  if (span.end - span.start === 1 && replacement === '' && p.junk.has(span.start)) return { approved: 'invisible' };
  const trap = p.traps.find((t) => touches(span, t));
  if (trap) return { problem: `touches the trap "${shown(p.text.slice(trap.start, trap.end))}"` };
  if (isSpacingOnly(p.text, span, replacement, p.junk)) return { approved: 'spacing' };
  return { problem: 'changes a word, a case or a punctuation mark without a click' };
}

/** Letters, digits and combining marks: a word goes on over them. */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;
/** Characters that join two words into one token: "for-profit", "to's", "and/or", "a+", "with#hash", "R&D". */
const WORD_JOINER = /[-'’/+#&_@]/u;

/** True when a word goes on across `outside` (the character next to the span) and `beyond` (the one past it). */
const continuesWord = (outside: string, beyond: string) =>
  WORD_CHARACTER.test(outside) || WORD_JOINER.test(outside) || (outside === '.' && WORD_CHARACTER.test(beyond));

/** True when `span` of `text` starts and ends on word boundaries: "Ph" in "Ph.D." does not end one. */
function onWordBoundaries(text: string, { start, end }: { start: number; end: number }): boolean {
  if (WORD_CHARACTER.test(text[start] ?? '') && continuesWord(text[start - 1] ?? '', text[start - 2] ?? '')) return false;
  return !(WORD_CHARACTER.test(text[end - 1] ?? '') && continuesWord(text[end] ?? '', text[end + 1] ?? ''));
}

type CaseShape = 'none' | 'lower' | 'title' | 'upper' | 'mixed';

/** "apple" lower, "A" and "Apple" title, "AN" upper, "iPhone" mixed, "," none. */
function caseShape(text: string): CaseShape {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  const upper = (ch: string) => ch !== ch.toLowerCase();
  if (letters.length === 0) return 'none';
  if (!letters.some(upper)) return 'lower';
  if (upper(letters[0]) && !letters.slice(1).some(upper)) return 'title';
  return letters.every(upper) ? 'upper' : 'mixed';
}

/**
 * True when the word at `i` starts a sentence: the paragraph's start, or after "?" or "!", or after a full stop
 * whose token is long, lowercase and undotted. "pm.", "Jan.", "Engg.", "Qty." and "Ph.D." end no sentence.
 */
function startsSentence(text: string, i: number): boolean {
  let j = i;
  while (j > 0 && /[\s"“‘(\[\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(text[j - 1])) j--;
  if (j === 0 || text[j - 1] === '?' || text[j - 1] === '!') return true;
  if (text[j - 1] !== '.') return false;
  let k = j - 1;
  while (k > 0 && !/\s/u.test(text[k - 1])) k--;
  const token = text.slice(k, j - 1).replace(INVISIBLE, '');
  return token.length > 4 && !/^\p{Lu}/u.test(token) && !token.includes('.');
}

/** The word right after `end`: "lpg" in "an lpg cylinder". */
const NEXT_WORD = /^\s+([\p{L}\p{N}'’-]+)/u;
const VOWEL = /[aeiou]/i;

/** Why a change "Review and apply all" made with the default ticks is wrong, or null when it is not. */
function cardProblem(o: Outcome, p: StressParagraph, dictionary: ReadonlySet<string>): string | null {
  const { span, original } = o.candidate;
  const replacement = o.replacement ?? '';
  const { text } = p;
  if (text.slice(span.start, span.end) !== original) return 'its offsets do not match the paragraph';
  if (!onWordBoundaries(text, span)) return 'does not start and end on word boundaries';
  if (replacement !== original && replacement.toLowerCase() === original.toLowerCase()) {
    const letters = [...original].filter((ch) => /\p{L}/u.test(ch)).length;
    const initialism = replacement === original.toUpperCase() && (letters >= 2 || original === 'i');
    const capitalised = caseShape(original) === 'lower' && replacement === original[0].toUpperCase() + original.slice(1);
    if (!initialism && !(capitalised && startsSentence(text, span.start))) return 'changes the case outside a sentence start';
  } else if (caseShape(original) !== caseShape(replacement)) {
    return `does not keep the case (${caseShape(original)} → ${caseShape(replacement)})`;
  }
  const article = new Set([original.toLowerCase(), replacement.toLowerCase()]);
  if (article.size === 2 && article.has('a') && article.has('an')) {
    const next = NEXT_WORD.exec(text.slice(span.end))?.[1] ?? '';
    if (!dictionary.has(next) || !VOWEL.test(next) || caseShape(next) !== 'lower') return `swaps the article before "${next}", not a dictionary word`;
  }
  const trap = p.traps.find((t) => touches(span, t));
  if (trap && isSpacingOnly(text, span, replacement, p.junk)) return `changes the layout of "${shown(text.slice(trap.start, trap.end))}"`;
  return null;
}

/** The lowercase words after the article swaps in `outcomes` that the spell checker knows. */
async function dictionaryWordsAfterArticles(outcomes: Outcome[], document: StressParagraph[], variant: Variant): Promise<Set<string>> {
  const words = [
    ...new Set(outcomes.flatMap((o) => NEXT_WORD.exec(document[o.candidate.paraId].text.slice(o.candidate.span.end))?.[1] ?? [])),
  ];
  const flagged = await linter.lintSpelling(words.map((text, id) => ({ id, text })), variant);
  return new Set(words.filter((_, id) => !flagged.some((f) => f.paraId === id)));
}

/** A printable view of a change, with invisible characters as <U+…>. */
function shown(text: string): string {
  return text.replace(INVISIBLE, (ch) => `<U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`);
}

/** An applied outcome replacing `original` (at `at`, by default its first place) in `text` with `replacement`. */
function outcomeAt(text: string, original: string, replacement: string, at = text.indexOf(original)): Outcome {
  const candidate = { id: 'x', paraId: 0, span: { start: at, end: at + original.length }, original, replacements: [replacement], kind: 'Typo', message: '', source: 'rules' as const };
  return { candidate, paragraphNumber: 1, status: 'applied', auto: true, replacement };
}

const LONE_SURROGATE =/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Every preset, with default settings and with every auto-apply kind on, in both text formats. */
const RUNS = (Object.keys(PRESETS) as PresetId[]).flatMap((preset) =>
  (['default settings', 'every auto-apply kind on'] as const).flatMap((setting) =>
    ([['plain text', plaintextAdapter], ['Markdown', markdownAdapter]] as const).map(([format, adapter]) => ({ preset, setting, format, adapter })),
  ),
);

describe('never damage: generated traps, under every preset and setting', () => {
  const document = stressDocument(SEED, PARAGRAPHS);

  it('the generator is deterministic and big enough', () => {
    expect(stressDocument(SEED, PARAGRAPHS).map((p) => p.text)).toEqual(document.map((p) => p.text));
    expect(sentenceCount(document)).toBeGreaterThan(300);
    expect(document.reduce((n, p) => n + p.traps.length, 0)).toBeGreaterThan(200);
  });

  it('the judge: only whitespace between unchanged tokens is spacing, and isolates pair as UAX #9 says', () => {
    const verdict = (text: string, original: string, replacement: string, junk: number[] = []) => {
      const p: StressParagraph = { text, traps: [], fixes: [], junk: new Set(junk) };
      return judge(outcomeAt(text, original, replacement), p);
    };
    const notSpacing = { problem: 'changes a word, a case or a punctuation mark without a click' };
    expect(verdict('We went  home.', '  ', ' ')).toEqual({ approved: 'spacing' });
    // A planted invisible character may go with the spaces; one the text needs may not (F4 re-review 3, M-1).
    expect(verdict('We went \u{200B} home.', ' \u{200B} ', ' ', [8])).toEqual({ approved: 'spacing' });
    expect(verdict('We went \u{200B} home.', ' \u{200B} ', ' ')).toEqual(notSpacing);
    expect(verdict('क्\u{200D} ष', '\u{200D} ', ' ')).toEqual(notSpacing);
    expect(verdict('We went  home.', '  ', ' \u{202E}')).toEqual(notSpacing);
    expect(verdict('We went home .', ' .', '.')).toEqual(notSpacing);
    expect(verdict('Is it done?', '?', '.')).toEqual(notSpacing);
    expect(verdict('Is it done?', '?', '!')).toEqual(notSpacing);
    expect(verdict('Send an e-mail.', 'e-mail', 'e mail')).toEqual(notSpacing);
    expect(verdict('A well-known fact.', 'well-known', 'well known')).toEqual(notSpacing);
    expect(verdict("Don't go.", "Don't", 'Don t')).toEqual(notSpacing);
    expect(verdict('Use and/or here.', 'and/or', 'and or')).toEqual(notSpacing);
    expect(verdict('The R&D team.', 'R&D', 'R D')).toEqual(notSpacing);
    expect(verdict('It was (not she) then.', '(not she)', 'not she')).toEqual(notSpacing);
    expect(verdict('Wait...', '...', '.')).toEqual(notSpacing);
    expect(verdict('It fell 50% today.', '50%', '50')).toEqual(notSpacing);
    expect(verdict('The Govt. of India.', 'of', 'Of')).toEqual(notSpacing);
    expect(verdict("We went to to's house.", "to to's", "toto's")).toEqual(notSpacing);
    expect(verdict('Send the file name.', 'file name', 'filename')).toEqual(notSpacing);
    expect(verdict('Send the filename.', 'filename', 'file name')).toEqual(notSpacing);
    expect(unpairedDirectionControls('a\u{202E}b\u{202C}c')).toBe(0);
    expect(unpairedDirectionControls('a\u{202E}bc')).toBe(1);
    expect(unpairedDirectionControls('a\u{202C}b\u{202D}c\u{202C}')).toBe(1);
    // The PDI ends the RLE opened inside its isolate, so the last PDF ends the RLO; without it the RLO stays open.
    expect(unpairedDirectionControls('\u{202E}abc \u{2066}x\u{202B}y\u{2069} z\u{202C} rest')).toBe(0);
    expect(unpairedDirectionControls('\u{202E}abc \u{2066}xy\u{2069} z rest')).toBe(1);
    expect(unpairedDirectionControls('a\u{2066}b\u{202C}c\u{2069}')).toBe(1);
  });

  it('the card judge: whole words, the case kept outside a sentence start, articles only before dictionary words', () => {
    const dictionary = new Set(['apple', 'elephant', 'ewe']);
    const problem = (text: string, original: string, replacement: string, at = text.indexOf(original), traps: [number, number][] = []) => {
      const p: StressParagraph = { text, traps: traps.map(([start, end]) => ({ start, end })), fixes: [], junk: new Set() };
      return cardProblem(outcomeAt(text, original, replacement, at), p, dictionary);
    };
    expect(problem('I think teh plan works.', 'teh', 'the')).toBeNull();
    expect(problem('He ate a apple.', 'a', 'an', 7)).toBeNull();
    expect(problem('A apple fell.', 'A', 'An')).toBeNull();
    expect(problem('We went to the the market.', 'the the', 'the')).toBeNull();
    expect(problem('It rained today. we left.', 'we', 'We')).toBeNull();
    expect(problem('Plug in a usb drive.', 'usb', 'USB')).toBeNull();
    expect(problem('A apple fell.', 'A', 'AN')).toBe('does not keep the case (title → upper)');
    expect(problem('It rained today. Ph.D. students came.', 'Ph', 'pH')).toBe('does not start and end on word boundaries');
    for (const [text, word] of [['Meet at 5 pm. tomorrow please.', 'tomorrow'], ['Jan. was cold.', 'was'], ['It rained. Engg. college is near.', 'college'], ['Sold. Qty. ten is fine.', 'ten']]) {
      expect(problem(text, word, word[0].toUpperCase() + word.slice(1))).toBe('changes the case outside a sentence start');
    }
    expect(problem('Buy an lpg cylinder.', 'an', 'a')).toBe('swaps the article before "lpg", not a dictionary word');
    expect(problem('He got an sms today.', 'an', 'a')).toBe('swaps the article before "sms", not a dictionary word');
    expect(problem('Pens    10 and more.', '    ', ' ', 4, [[0, 10]])).toBe('changes the layout of "Pens    10"');
  });

  it.each(RUNS)('$format, $preset preset, $setting: every change made without a click is approved', async ({ preset, setting, adapter }) => {
    const file = document.map((p) => p.text).join('\n\n') + '\n';
    const { paras, handle } = await adapter.read(new TextEncoder().encode(file));
    expect(paras.map((p) => p.text)).toEqual(document.map((p) => p.text));

    const session = await CheckSession.start(
      paras,
      {
        preset,
        fallbackVariant: 'Indian',
        language: adapter.language,
        dictionary: [],
        modules: DEFAULT_MODULES,
        tierOverrides: setting === 'default settings' ? undefined : EVERYTHING_AUTO,
      },
      { linter },
    );

    const problems: string[] = [];
    const approved = new Map<Approved, number>();
    for (const o of session.outcomes()) {
      if (o.status !== 'applied' || !o.auto) continue;
      const verdict = judge(o, document[o.candidate.paraId]);
      if ('approved' in verdict) approved.set(verdict.approved, (approved.get(verdict.approved) ?? 0) + 1);
      else problems.push(`¶${o.candidate.paraId} ${o.candidate.kind} "${shown(o.candidate.original)}" → "${shown(o.replacement ?? '')}": ${verdict.problem}`);
    }
    // Every edit at session start was made without a click: together they keep every token, and every invisible
    // character nobody planted, too.
    document.forEach((p, id) => {
      if (!sameTokens(p.text, session.outputText(id))) problems.push(`¶${id} "${shown(session.outputText(id))}": a token changed`);
      if (!keepsUnplantedInvisibles(p, session.outputText(id))) problems.push(`¶${id} "${shown(session.outputText(id))}": an invisible character changed`);
    });
    for (const e of session.acceptedEdits()) {
      const at = boundaries(document[e.paraId].text);
      const oneCharacter = e.span.end - e.span.start === 1 && e.replacement === '';
      if (!oneCharacter && (!at.has(e.span.start) || !at.has(e.span.end))) {
        problems.push(`¶${e.paraId} edit ${e.span.start}-${e.span.end} splits a grapheme cluster`);
      }
    }
    problems.push(...splitDirectionPairs(session, document));
    // Soft, so the card below is judged too and a failure lists both.
    expect.soft(problems).toEqual([]);
    // The approved changes still happen: the test can't pass by the engine changing nothing.
    expect(approved.get('invisible')).toBeGreaterThan(50);
    expect(approved.get('spacing')).toBeGreaterThan(0);

    // The planted errors are still found: each waits in a decision with its one right fix.
    const { top, more } = session.decisions();
    const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
    const plantedOffered = session
      .candidates()
      .filter((c) => offered.has(c.id) && document[c.paraId].fixes.some((f) => f.start === c.span.start && f.end === c.span.end && f.right === c.replacements[0]));
    expect(plantedOffered.length).toBeGreaterThan(10);

    const { bytes, unplaceable } = await adapter.write(handle, session.acceptedEdits(), 'clean');
    expect(unplaceable).toEqual([]);
    const saved = new TextDecoder().decode(bytes);
    expect(saved).toBe(document.map((_, id) => session.outputText(id)).join('\n\n') + '\n');
    expect(saved).not.toContain('\u{FFFD}');
    expect(LONE_SURROGATE.test(saved)).toBe(false);

    // "Review and apply all" on the simple-fixes card with its default ticks: one click, nothing inspected
    // (F4 re-review 3), so each change it makes is judged too.
    const card = [...top, ...more].find((d) => d.id === SIMPLE_FIXES_ID);
    expect(card).toBeDefined();
    const startUnticked = new Set(card!.startUnticked ?? []);
    session.applyBatch(SIMPLE_FIXES_ID, card!.candidateIds.filter((id) => !startUnticked.has(id)));
    const byCard = session.outcomes().filter((o) => o.status === 'applied' && o.batch !== undefined);
    const dictionary = await dictionaryWordsAfterArticles(byCard, document, session.variant);
    const cardProblems = byCard.flatMap((o) => {
      const why = cardProblem(o, document[o.candidate.paraId], dictionary);
      return why === null ? [] : [`¶${o.candidate.paraId} ${o.candidate.kind} "${shown(o.candidate.original)}" → "${shown(o.replacement ?? '')}": ${why}`];
    });
    cardProblems.push(...splitDirectionPairs(session, document));
    expect(cardProblems).toEqual([]);
    // The judge saw the card's changes, and the planted errors are still fixed by the one click.
    expect(byCard.length).toBeGreaterThan(10);
    const plantedFixed = byCard.filter((o) =>
      document[o.candidate.paraId].fixes.some((f) => f.start === o.candidate.span.start && f.end === o.candidate.span.end && f.right === o.replacement),
    );
    expect(plantedFixed.length).toBeGreaterThan(10);
  }, 60_000);

  it('accepting every suggestion never replaces a word-card word, cuts a word an invisible character split, or splits a direction pair', async () => {
    const paras = document.map((p, id) => ({ id, text: p.text }));
    const session = await CheckSession.start(
      paras,
      { preset: 'academic', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [], modules: DEFAULT_MODULES },
      { linter },
    );
    const { top, more } = session.decisions();
    const onWordCards = new Set([...top, ...more].filter((d) => d.kind !== 'single' && d.kind !== 'batch').flatMap((d) => d.candidateIds));
    acceptAllRules(session);

    const problems: string[] = [];
    for (const o of session.outcomes()) {
      if (o.status !== 'applied') continue;
      const { id, paraId, span, original } = o.candidate;
      const p = document[paraId];
      const change = `¶${paraId} ${o.candidate.kind} "${shown(original)}" → "${shown(o.replacement ?? '')}"`;
      if (onWordCards.has(id)) problems.push(`${change}: replaces a word the user answers on a card`);
      if (splitsWord(p, span.start - 1) || splitsWord(p, span.end)) problems.push(`${change}: cuts a word at an invisible character`);
    }
    problems.push(...splitDirectionPairs(session, document));
    expect(problems).toEqual([]);
  }, 60_000);
});

const LETTER = /\p{L}/u;

/** True when position `i` holds a planted invisible character between two letters ("mod<U+200B>els"). */
function splitsWord(p: StressParagraph, i: number): boolean {
  return p.junk.has(i) && LETTER.test(p.text[i - 1] ?? '') && LETTER.test(p.text[i + 1] ?? '');
}
