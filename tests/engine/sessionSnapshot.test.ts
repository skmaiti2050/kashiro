import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { restore, snapshot, SNAPSHOT_VERSION, type SessionSnapshot } from '@/engine/sessionSnapshot';
import type { Paragraph } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const opts: CheckOptions = { preset: 'business', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] };
const start = (paras: Paragraph[]) => CheckSession.start(paras, opts, { linter });
const VIEW = { preset: 'business' as const, variantOverride: null, documentIgnoredRules: [] };

const PARAS: Paragraph[] = [
  { id: 0, text: 'I think teh cat is here.' },
  { id: 1, text: 'She recieved the letter.' },
  { id: 2, text: 'We was late again.' },
];

const byOriginal = (s: CheckSession, original: string) => s.candidates().find((c) => c.original === original)!;
/** Every candidate's status by what it flags (ids may differ between checks). */
const statuses = (s: CheckSession) =>
  Object.fromEntries(s.outcomes().map((o) => [`${o.paragraphNumber}:${o.candidate.original}@${o.candidate.span.start}`, [o.status, o.replacement]]));

/** A session with an accept, a reject and an undone auto-fix. */
async function decided(paras: Paragraph[]): Promise<CheckSession> {
  const s = await start(paras);
  s.accept(byOriginal(s, 'recieved').id);
  s.reject(byOriginal(s, 'was').id);
  const auto = s.outcomes().find((o) => o.auto && o.status === 'applied')!;
  s.undo(auto.candidate.id);
  return s;
}

describe('snapshot', () => {
  it('holds the user decisions, the view and paragraph hashes, never the text', async () => {
    const s = await decided(PARAS);
    const snap = await snapshot(s, { preset: 'academic', variantOverride: 'British', documentIgnoredRules: ['Style'] });
    expect(snap.version).toBe(SNAPSHOT_VERSION);
    expect(snap).toMatchObject({ preset: 'academic', depth: 'standard', variantOverride: 'British', documentIgnoredRules: ['Style'] });
    expect(snap.paragraphs).toHaveLength(3);
    for (const hash of snap.paragraphs) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.decisions.map((d) => [d.paragraph, d.original, d.status])).toEqual([
      [0, 'teh', 'rejected'],
      [1, 'recieved', 'applied'],
      [2, 'was', 'rejected'],
    ]);
    const json = JSON.stringify(snap);
    for (const p of PARAS) expect(json).not.toContain(p.text);
  });

  it('leaves out pending flags, auto-fixes still applied and words added to the dictionary', async () => {
    // Its own linter: adding a word changes the linter for good.
    const s = await CheckSession.start(PARAS, opts, { linter: await createLinter('American') });
    await s.addToDictionary(byOriginal(s, 'recieved').id);
    expect(s.outcomes().find((o) => o.candidate.original === 'recieved')!.status).toBe('rejected');
    expect((await snapshot(s, VIEW)).decisions).toEqual([]);
  });
});

describe('restore', () => {
  it('round-trips every status exactly on an unchanged document', async () => {
    const before = await decided(PARAS);
    const snap = await snapshot(before, VIEW);
    const { session, restored, rechecked } = await restore(PARAS, snap, opts, { linter });
    expect(statuses(session)).toEqual(statuses(before));
    expect(session.outputText(1)).toBe(before.outputText(1));
    expect(restored).toBe(3);
    expect(rechecked).toBe(0);
  });

  it('a changed paragraph drops its decisions; the others keep theirs, even when they moved', async () => {
    const before = await decided(PARAS);
    const snap = await snapshot(before, VIEW);
    const changed: Paragraph[] = [
      { id: 0, text: 'A new first paragraph.' },
      { id: 1, text: 'I think teh cat is here.' },
      { id: 2, text: 'She recieved the letter.' },
      { id: 3, text: 'We was very late again.' },
    ];
    const { session, restored, rechecked } = await restore(changed, snap, opts, { linter });
    const status = (original: string) => session.outcomes().find((o) => o.candidate.original === original)!.status;
    expect(status('recieved')).toBe('applied');
    expect(status('teh')).toBe('rejected'); // the undone auto-fix stays undone
    expect(status('was')).toBe('pending'); // its paragraph changed
    expect(restored).toBe(2);
    expect(rechecked).toBe(2);
  });

  it('replays an accept once: restoring twice from the same snapshot never doubles an edit', async () => {
    const before = await decided(PARAS);
    const snap = await snapshot(before, VIEW);
    const once = (await restore(PARAS, snap, opts, { linter })).session;
    const again = (await restore(PARAS, await snapshot(once, VIEW), opts, { linter })).session;
    expect(again.acceptedEdits()).toEqual(before.acceptedEdits());
    expect(again.outputText(1)).toBe('She received the letter.');
  });

  it('starts with the snapshot depth', async () => {
    const before = await start(PARAS);
    before.setDepth('light');
    const snap: SessionSnapshot = await snapshot(before, VIEW);
    expect((await restore(PARAS, snap, opts, { linter })).session.depth).toBe('light');
  });
});
