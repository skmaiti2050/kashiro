/**
 * A rule fix inside an edit already applied (an AI rewrite, another card) was made for the text that edit replaced.
 * Applying it would supersede the edit and change words outside its own span, so it is withdrawn from the review
 * while the edit stays, refused if asked for, and comes back when the edit is undone (final F13 review I-2, Task F14).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { PresetId } from '@/engine/presets';
import type { Candidate, Paragraph } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const start = (paras: Paragraph[], preset: PresetId = 'business') =>
  CheckSession.start(paras, { preset, variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] }, { linter });

const statusOf = (s: CheckSession, id: string) => s.outcomes().find((o) => o.candidate.id === id)!;
const offered = (s: CheckSession) => {
  const { top, more } = s.decisions();
  return [...top, ...more];
};
const offeredIds = (s: CheckSession) => offered(s).flatMap((d) => d.candidateIds);
const output = (s: CheckSession) => s.paragraphs().map((p) => s.outputText(p.id));

const rule = (id: string, start: number, original: string, replacement: string, kind = 'WordChoice'): Candidate => ({
  id,
  paraId: 0,
  span: { start, end: start + original.length },
  original,
  replacements: [replacement],
  kind,
  message: 'm',
  source: 'rules',
});

describe('a rule fix inside an applied edit (Task F14)', () => {
  // The review's repro: the rewrite changes words outside the spelling fix's span.
  it('an accepted AI rewrite withdraws the spelling fix inside it from the card; undoing the rewrite brings it back', async () => {
    const POST = 'I recieve post daily.';
    const CALLS = 'You recieve "sic" calls.';
    const REWRITE = 'Post reaches me daily.';
    const s = await start([
      { id: 0, text: POST },
      { id: 1, text: CALLS },
    ]);
    const card = offered(s).find((d) => d.candidateIds.includes('0:2:9:Spelling'))!;
    expect(card.candidateIds).toEqual(['0:2:9:Spelling', '1:4:11:Spelling']);
    expect(s.addRewrite(0, { start: 0, end: POST.length }, REWRITE, POST)).toEqual({ ok: true });

    const batch = s.applyRewrites(['llm:0:0-21']);
    expect(output(s)).toEqual([REWRITE, CALLS]);
    expect(offeredIds(s)).not.toContain('0:2:9:Spelling');
    expect(offeredIds(s)).toContain('1:4:11:Spelling');
    expect(statusOf(s, '0:2:9:Spelling')).toMatchObject({ status: 'superseded', reason: 'superseded by llm:0:0-21' });

    // Every accept path refuses it: never applied over the rewrite.
    expect(() => s.accept('0:2:9:Spelling')).toThrow();
    expect(() => s.applyBatch(card.id, ['0:2:9:Spelling'])).toThrow();
    expect(output(s)).toEqual([REWRITE, CALLS]);
    expect(statusOf(s, 'llm:0:0-21').status).toBe('applied');

    s.undoBatch(batch);
    expect(output(s)).toEqual([POST, CALLS]);
    expect(statusOf(s, '0:2:9:Spelling').status).toBe('pending');
    expect(offered(s).find((d) => d.candidateIds.includes('0:2:9:Spelling'))!.candidateIds).toEqual(['0:2:9:Spelling', '1:4:11:Spelling']);
    s.accept('0:2:9:Spelling');
    expect(output(s)).toEqual(['I receive post daily.', CALLS]);
  });

  it('a card over another card’s applied span leaves the review until that card is undone', async () => {
    const TEXT = 'The quick brown fox jumps.';
    const s = await start([{ id: 0, text: TEXT }]);
    const wide = rule('test:wide', 4, 'quick brown', 'fast brown');
    const inside = rule('test:inside', 10, 'brown', 'tan');
    s.addCandidates([wide, inside]);
    expect([s.tier(wide.id), s.tier(inside.id)]).toEqual(['review', 'review']);
    expect(offeredIds(s)).toEqual(expect.arrayContaining([wide.id, inside.id]));

    s.accept(wide.id);
    expect(output(s)).toEqual(['The fast brown fox jumps.']);
    expect(offeredIds(s)).not.toContain(inside.id);
    expect(statusOf(s, inside.id)).toMatchObject({ status: 'superseded', reason: 'superseded by test:wide' });
    expect(() => s.accept(inside.id)).toThrow();
    expect(output(s)).toEqual(['The fast brown fox jumps.']);
    expect(statusOf(s, wide.id).status).toBe('applied');

    s.undo(wide.id);
    expect(output(s)).toEqual([TEXT]);
    expect(statusOf(s, inside.id).status).toBe('pending');
    expect(offeredIds(s)).toContain(inside.id);
    s.accept(inside.id);
    expect(output(s)).toEqual(['The quick tan fox jumps.']);
  });

  it('a fix added inside an edit already applied is never offered', async () => {
    const s = await start([{ id: 0, text: 'The quick brown fox jumps.' }]);
    s.addCandidates([rule('test:wide', 4, 'quick brown', 'fast brown')]);
    s.accept('test:wide');
    s.addCandidates([rule('test:inside', 10, 'brown', 'tan')]);
    expect(offeredIds(s)).not.toContain('test:inside');
    expect(statusOf(s, 'test:inside').status).toBe('superseded');
  });

  it('a batch never applies a member over another member it has just applied; undoing the batch brings it back', async () => {
    const s = await start([{ id: 0, text: 'The quick fox and the quick dog.' }], 'blog');
    // Two flags of the same place in one batch (as two rules can give): the second would supersede the first.
    s.addCandidates([rule('a', 4, 'quick', 'fast', 'Style'), rule('b', 4, 'quick', 'fast', 'Style'), rule('c', 22, 'quick', 'fast', 'Style')]);
    const batch = offered(s).find((d) => d.candidateIds.includes('a'))!;
    expect(batch.candidateIds).toEqual(['a', 'b', 'c']);

    const id = s.applyBatch(batch.id);
    expect(output(s)).toEqual(['The fast fox and the fast dog.']);
    expect(['a', 'b', 'c'].map((m) => statusOf(s, m).status)).toEqual(['applied', 'superseded', 'applied']);
    expect(statusOf(s, 'b').reason).toBe('superseded by a');

    s.undoBatch(id);
    expect(output(s)).toEqual(['The quick fox and the quick dog.']);
    expect(['a', 'b', 'c'].map((m) => statusOf(s, m).status)).toEqual(['rejected', 'pending', 'rejected']);
  });
});
