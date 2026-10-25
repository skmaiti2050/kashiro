/**
 * Task F4 (owner decision): nothing that changes a word is applied without a click. Only invisible characters
 * and runs of spaces between words change on their own; every other safe fix waits on one "simple fixes" card,
 * and an independent token check takes back any change made without a click that slipped through.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { AUTO_APPLY_KINDS } from '@/ui/state/settings';
import { acceptAllRules } from '../../cli/run';
import type { Candidate, Paragraph, Tier } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const opts = (over: Partial<CheckOptions> = {}): CheckOptions => ({
  preset: 'business',
  variant: 'American',
  fallbackVariant: 'American',
  language: 'plaintext',
  dictionary: [],
  ...over,
});

const start = (paras: Paragraph[], over: Partial<CheckOptions> = {}, with_ = linter) => CheckSession.start(paras, opts(over), { linter: with_ });
const autoChanges = (s: CheckSession) => s.outcomes().filter((o) => o.status === 'applied' && o.auto).map((o) => `${o.candidate.kind}: "${o.candidate.original}" → "${o.replacement}"`);
const EVERYTHING_AUTO: Partial<Record<string, Tier>> = Object.fromEntries(AUTO_APPLY_KINDS.map((k) => [k, 'safe']));

// A spelling slip, a doubled word, an article, a capital, a space before a full stop and a run of spaces.
const TEXT = 'I think teh cat of of mine ate a apple. it rained . We went  home.';

describe('changes made without a click (Task F4)', () => {
  it('are only invisible characters and spaces between words, whatever the settings say', async () => {
    for (const tierOverrides of [undefined, EVERYTHING_AUTO]) {
      const s = await start([{ id: 0, text: `${TEXT} He go\u{200B}es there.` }], { tierOverrides });
      expect(autoChanges(s)).toEqual(['Formatting: "  " → " "', 'Invisible: "\u{200B}" → ""']);
      expect(s.outputText(0)).toBe(`${TEXT.replace('  ', ' ')} He goes there.`);
    }
  });

  it('every other safe fix waits on one simple-fixes card, which counts as one decision and applies all at once', async () => {
    const s = await start([{ id: 0, text: TEXT }]);
    const card = s.decisions().top.find((d) => d.id === SIMPLE_FIXES_ID)!;
    expect(card).toMatchObject({ kind: 'batch', label: '4 simple fixes: review and apply all' });
    const byId = new Map(s.candidates().map((c) => [c.id, c]));
    expect(card.candidateIds.map((id) => byId.get(id)!.original)).toEqual(['teh', 'of of', 'a', ' ']);
    expect(s.decisions().top.filter((d) => d.candidateIds.some((id) => card.candidateIds.includes(id)))).toHaveLength(1);

    s.applyBatch(card.id);
    expect(s.outputText(0)).toBe('I think the cat of mine ate an apple. it rained. We went home.');
  });

  it('a member of the card can be unticked; it stays on a smaller card', async () => {
    const s = await start([{ id: 0, text: TEXT }]);
    const card = s.decisions().top.find((d) => d.id === SIMPLE_FIXES_ID)!;
    const [teh, ...rest] = card.candidateIds;
    s.applyBatch(card.id, rest);
    expect(s.outputText(0)).toBe('I think teh cat of mine ate an apple. it rained. We went home.');
    expect(s.decisions().top.find((d) => d.id === SIMPLE_FIXES_ID)?.candidateIds).toEqual([teh]);
  });

  it('a kind the user put on auto-apply joins the simple-fixes card, unticked, instead of being applied (owner, 2026-10-25)', async () => {
    const text = 'He go there. I think teh plan works.';
    const before = await start([{ id: 0, text }]);
    const after = await start([{ id: 0, text }], { tierOverrides: EVERYTHING_AUTO });
    const id = (s: CheckSession, original: string) => s.candidates().find((c) => c.original === original)!.id;
    expect(after.candidates().find((c) => c.original === 'go')!.kind).toBe('Agreement');
    expect(before.decisions().top.find((d) => d.id === SIMPLE_FIXES_ID)?.candidateIds).toEqual([id(before, 'teh')]);
    const card = after.decisions().top.find((d) => d.id === SIMPLE_FIXES_ID)!;
    expect(card.candidateIds).toEqual([id(after, 'go'), id(after, 'teh')]);
    // Only the built-in fix starts ticked: "apply all" with the default ticks leaves "go" for the user to tick.
    expect(card.startUnticked).toEqual([id(after, 'go')]);
    expect(autoChanges(after)).toEqual([]);
  });
});

/** A linter that returns `lints` for paragraph 0, whatever the text: a stand-in for a future rule bug. */
function fakeLinter(lints: Omit<Candidate, 'id' | 'paraId' | 'source'>[]): RulesLinter {
  return {
    variant: 'American',
    async lintParagraphs(paras) {
      return paras.flatMap((p) =>
        p.id === 0 ? lints.map((l) => ({ ...l, id: `0:${l.span.start}:${l.span.end}:${l.kind}`, paraId: 0, source: 'rules' as const })) : [],
      );
    },
    async lintSpelling() {
      return [];
    },
    async addWords() {},
    async setVariant() {},
  };
}

describe('the token check behind every change made without a click (Task F4)', () => {
  it('takes back a change that would alter a token and sends it to review', async () => {
    // A rule bug: the flag says "two spaces" but its span covers the letters "ta".
    const text = 'Send itab now.';
    const bad = { span: { start: 6, end: 8 }, original: '  ', replacements: [' '], kind: 'Formatting', message: 'There are 2 spaces' };
    const s = await start([{ id: 0, text }], {}, fakeLinter([bad]));
    const c = s.candidates()[0];
    expect(s.outputText(0)).toBe(text);
    expect(autoChanges(s)).toEqual([]);
    expect(s.tier(c.id)).toBe('review');
    expect(s.outcomes()[0]).toMatchObject({ status: 'pending', reason: 'held back: it would change a word' });
  });
});

describe('a card changes only what it shows (Task F4 item 4, F3 re-review 2 I-4)', () => {
  it('a spacing fix across a direction control hygiene keeps offers no fix, so accepting everything keeps the control', async () => {
    const text = 'He said "\u{202E}sales" today  \u{202C}  and left.';
    const s = await start([{ id: 0, text }]);
    const spacing = s.candidates().find((c) => c.kind === 'Formatting')!;
    expect(spacing.original).toBe('  \u{202C}  ');
    expect(spacing.replacements).toEqual([]);
    acceptAllRules(s);
    expect(s.outputText(0)).toContain('\u{202C}');
    expect(s.outputText(0)).toBe(text);
  });
});
