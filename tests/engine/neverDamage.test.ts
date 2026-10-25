/**
 * Never-damage stress test (CLAUDE.md rule #1, external review #4): several hundred generated sentences full
 * of traps (legitimate doublings, invisible and bidi characters, list labels, acronyms, names, amounts, Hindi
 * and Bengali, quotes, URLs, code), checked with every auto-apply setting on. Any automatic change outside
 * the approved list fails:
 *   - deleting an invisible character the generator planted (never a joiner Indic text needs);
 *   - the one approved fix of a planted error ("teh" → "the", "a apple" → "an apple", "the the" → "the");
 *   - whitespace and punctuation only, between words it leaves as they were (no join or split), away from every trap;
 *   - a kind the user moved to auto-apply in Settings, away from every trap.
 * Every edit must also start and end on grapheme-cluster boundaries, no direction-control pair may lose one
 * end, and the saved file must equal the paragraphs with the edits applied, without U+FFFD. The seed is
 * fixed, so a failure is reproducible.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type Outcome } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Tier } from '@/engine/types';
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

/** Every kind the Settings panel can move to auto-apply, moved. */
const EVERYTHING_AUTO: Partial<Record<string, Tier>> = Object.fromEntries(AUTO_APPLY_KINDS.map((k) => [k, 'safe']));

/** What a whitespace-and-punctuation change may touch: "  " → " ", " ," → ",". */
const SPACE_OR_PUNCTUATION = /[\s\p{P}]/gu;
/** A word as the spacing check counts them: "to" and "s" in "to's". */
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

/**
 * True when the change only adds or removes whitespace and punctuation between words it leaves as they were:
 * the paragraph's word sequence is the same after it. "to to's" → "toto's" and "file name" → "filename" join
 * words, so they are not spacing (F3 re-review, I-3).
 */
function isSpacingOnly(p: StressParagraph, span: { start: number; end: number }, original: string, replacement: string): boolean {
  if (original.replace(SPACE_OR_PUNCTUATION, '') !== replacement.replace(SPACE_OR_PUNCTUATION, '')) return false;
  const before = p.text.match(WORD) ?? [];
  const after = (p.text.slice(0, span.start) + replacement + p.text.slice(span.end)).match(WORD) ?? [];
  return before.length === after.length && before.every((word, i) => word === after[i]);
}

/** Direction embeddings and overrides (U+202A, U+202B, U+202D, U+202E) and their end, U+202C. */
const DIRECTION_OPEN = /[\u{202A}\u{202B}\u{202D}\u{202E}]/u;
const DIRECTION_END = '\u{202C}';

/** Direction controls without a partner: an opener never ended, or an end with nothing open. */
function unpairedDirectionControls(text: string): number {
  let open = 0;
  let unpaired = 0;
  for (const ch of text) {
    if (DIRECTION_OPEN.test(ch)) open++;
    else if (ch === DIRECTION_END) {
      if (open > 0) open--;
      else unpaired++;
    }
  }
  return unpaired + open;
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

type Approved = 'invisible' | 'planted' | 'spacing' | 'opted in';

/** The approved-list entry this automatic change falls under, or why it falls under none. */
function judge(o: Outcome, p: StressParagraph): { approved: Approved } | { problem: string } {
  const { span, original } = o.candidate;
  const replacement = o.replacement ?? '';
  if (p.text.slice(span.start, span.end) !== original) return { problem: 'its offsets do not match the paragraph' };
  if (span.end - span.start === 1 && replacement === '' && p.junk.has(span.start)) return { approved: 'invisible' };
  const planted = p.fixes.find((f) => f.start === span.start && f.end === span.end);
  if (planted) return planted.right === replacement ? { approved: 'planted' } : { problem: `planted error fixed as "${replacement}"` };
  const trap = p.traps.find((t) => touches(span, t));
  if (trap) return { problem: `touches the trap "${shown(p.text.slice(trap.start, trap.end))}"` };
  if (isSpacingOnly(p, span, original, replacement)) return { approved: 'spacing' };
  // The user asked for these kinds to be applied; the traps above still bind them.
  if (AUTO_APPLY_KINDS.includes(o.candidate.kind)) return { approved: 'opted in' };
  return { problem: 'not on the approved list' };
}

/** Invisible, direction and variation characters, to print as <U+…>. */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** A printable view of a change, with invisible characters as <U+…>. */
function shown(text: string): string {
  return text.replace(INVISIBLE, (ch) => `<U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`);
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('never damage: generated traps, every auto-apply setting on', () => {
  const document = stressDocument(SEED, PARAGRAPHS);

  it('the generator is deterministic and big enough', () => {
    expect(stressDocument(SEED, PARAGRAPHS).map((p) => p.text)).toEqual(document.map((p) => p.text));
    expect(sentenceCount(document)).toBeGreaterThan(300);
    expect(document.reduce((n, p) => n + p.traps.length, 0)).toBeGreaterThan(200);
  });

  it('the judge: spacing keeps every word, and a half-deleted direction pair is caught', () => {
    const paragraph = (text: string): StressParagraph => ({ text, traps: [], fixes: [], junk: new Set() });
    const auto = (p: StressParagraph, original: string, replacement: string, kind = 'Typo'): Outcome => {
      const start = p.text.indexOf(original);
      const candidate = { id: 'x', paraId: 0, span: { start, end: start + original.length }, original, replacements: [replacement], kind, message: '', source: 'rules' as const };
      return { candidate, paragraphNumber: 1, status: 'applied', auto: true, replacement };
    };
    const verdict = (text: string, original: string, replacement: string) => judge(auto(paragraph(text), original, replacement), paragraph(text));
    expect(verdict('We went  home.', '  ', ' ')).toEqual({ approved: 'spacing' });
    expect(verdict('We went home .', ' .', '.')).toEqual({ approved: 'spacing' });
    expect(verdict("We went to to's house.", "to to's", "toto's")).toEqual({ problem: 'not on the approved list' });
    expect(verdict('Send the file name.', 'file name', 'filename')).toEqual({ problem: 'not on the approved list' });
    expect(verdict('Send the filename.', 'filename', 'file name')).toEqual({ problem: 'not on the approved list' });
    expect(unpairedDirectionControls('a\u{202E}b\u{202C}c')).toBe(0);
    expect(unpairedDirectionControls('a\u{202E}bc')).toBe(1);
    expect(unpairedDirectionControls('a\u{202C}b\u{202D}c\u{202C}')).toBe(1);
  });

  it.each([
    ['plain text', plaintextAdapter],
    ['Markdown', markdownAdapter],
  ] as const)('%s: every automatic change is approved and lands cleanly', async (_name, adapter) => {
    const file = document.map((p) => p.text).join('\n\n') + '\n';
    const { paras, handle } = await adapter.read(new TextEncoder().encode(file));
    expect(paras.map((p) => p.text)).toEqual(document.map((p) => p.text));

    const session = await CheckSession.start(
      paras,
      {
        preset: 'academic', // nothing hidden, and the contractions check on
        fallbackVariant: 'Indian',
        language: adapter.language,
        dictionary: [],
        modules: DEFAULT_MODULES,
        tierOverrides: EVERYTHING_AUTO,
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
    for (const e of session.acceptedEdits()) {
      const at = boundaries(document[e.paraId].text);
      const oneCharacter = e.span.end - e.span.start === 1 && e.replacement === '';
      if (!oneCharacter && (!at.has(e.span.start) || !at.has(e.span.end))) {
        problems.push(`¶${e.paraId} edit ${e.span.start}-${e.span.end} splits a grapheme cluster`);
      }
    }
    problems.push(...splitDirectionPairs(session, document));
    expect(problems).toEqual([]);
    // The approved fixes still happen: the test can't pass by the engine changing nothing.
    expect(approved.get('invisible')).toBeGreaterThan(50);
    expect(approved.get('planted')).toBeGreaterThan(10);

    const { bytes, unplaceable } = await adapter.write(handle, session.acceptedEdits(), 'clean');
    expect(unplaceable).toEqual([]);
    const saved = new TextDecoder().decode(bytes);
    expect(saved).toBe(document.map((_, id) => session.outputText(id)).join('\n\n') + '\n');
    expect(saved).not.toContain('\u{FFFD}');
    expect(LONE_SURROGATE.test(saved)).toBe(false);
  }, 60_000);

  it('accepting every suggestion never replaces a word-card word or cuts a word an invisible character split', async () => {
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
