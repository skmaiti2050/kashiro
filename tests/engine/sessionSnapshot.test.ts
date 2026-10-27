import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { restore, snapshot, SNAPSHOT_VERSION, type SessionSnapshot } from '@/engine/sessionSnapshot';
import { sha256Hex } from '@/engine/sha256';
import type { Paragraph } from '@/engine/types';
import { adapterFor } from '@/formats/registry';
import { SAMPLE_TEXT } from '@/ui/state/sample';
import { readFileSync } from 'node:fs';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const opts: CheckOptions = { preset: 'business', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] };
const start = (paras: Paragraph[]) => CheckSession.start(paras, opts, { linter });
const VIEW = { preset: 'business' as const, variantOverride: null, documentIgnoredRules: [] };

const PARAS: Paragraph[] = [
  // Two spaces: the one change here made without a click (Task F4); "teh" waits on the simple-fixes card.
  { id: 0, text: 'I think teh cat is  here.' },
  { id: 1, text: 'She recieved the letter.' },
  { id: 2, text: 'We was late again.' },
];

const byOriginal = (s: CheckSession, original: string) => s.candidates().find((c) => c.original === original)!;
/** Every candidate's status by what it flags (ids may differ between checks). */
const statuses = (s: CheckSession) =>
  Object.fromEntries(s.outcomes().map((o) => [`${o.paragraphNumber}:${o.candidate.original}@${o.candidate.span.start}`, [o.status, o.replacement]]));

/** The longest run of a paragraph's text (in characters) that also appears in `json`. */
function longestSharedRun(json: string, paras: Paragraph[]): number {
  let longest = 0;
  for (const { text } of paras) {
    for (let start = 0; start < text.length; start++) {
      let length = longest + 1;
      while (start + length <= text.length && json.includes(text.slice(start, start + length))) longest = length++;
    }
  }
  return longest;
}

/** Runs `first`; when the engine refuses it (a clash with an edit already applied), runs `otherwise`. */
function tryOr(first: () => void, otherwise: () => void): void {
  try {
    first();
  } catch {
    otherwise();
  }
}

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
    // No words at all: a flag is its paragraph, kind and offsets; an accepted fix is a short hash of its replacement.
    expect(snap.decisions).toEqual([
      { paragraph: 0, kind: 'Formatting', start: 18, end: 20, status: 'rejected' },
      { paragraph: 1, kind: 'Spelling', start: 4, end: 12, status: 'applied', replacementHash: (await sha256Hex('received')).slice(0, 16) },
      { paragraph: 2, kind: 'Agreement', start: 3, end: 6, status: 'rejected' },
    ]);
    const json = JSON.stringify(snap);
    for (const p of PARAS) expect(json).not.toContain(p.text);
  });

  it('never holds a sentence: an accepted LLM rewrite and a rejected sentence-long flag leave no text behind', async () => {
    const long =
      'This is a very long sentence that goes on and on and on with many many words in it so that the checker will surely ' +
      'think that it is far too long for anyone to read comfortably in one breath without stopping at all today.';
    const paras: Paragraph[] = [
      { id: 0, text: 'The meeting was held on Monday and everyone who could come attended it.' },
      { id: 1, text: long },
    ];
    const s = await start(paras);
    const rewrite = 'Everyone who could come attended the meeting on Monday.';
    expect(s.addRewrite(0, { start: 0, end: paras[0].text.length }, rewrite)).toEqual({ ok: true });
    s.accept(`llm:0:0-${paras[0].text.length}`);
    const readability = s.candidates().find((c) => c.paraId === 1 && c.span.end - c.span.start === long.length)!;
    s.reject(readability.id);

    const json = JSON.stringify(await snapshot(s, VIEW));
    expect(json).not.toContain(rewrite);
    expect(longestSharedRun(json, paras)).toBeLessThan(12);
    expect(JSON.parse(json).decisions).toEqual([{ paragraph: 1, kind: 'Readability', start: 0, end: long.length, status: 'rejected' }]);
  });

  it('no paragraph text of 12 or more characters in the snapshot of any sample document, every flag decided', async () => {
    const docs = ['paper.md', 'paper.txt', 'prose.md', 'prose.txt', 'prose_zw.txt'].map((name) => ({ name, bytes: readFileSync(`trust/corpus/${name}`) }));
    docs.push({ name: 'Sample.txt', bytes: Buffer.from(SAMPLE_TEXT) });
    for (const { name, bytes } of docs) {
      const adapter = adapterFor(name)!;
      const { paras } = await adapter.read(new Uint8Array(bytes));
      const s = await CheckSession.start(paras, { ...opts, language: adapter.language }, { linter });
      // Every candidate decided: auto-fixes undone, then the first fix accepted where there is one, else rejected.
      // Two passes: a flag spanning an invisible character supersedes its auto-applied deletion when accepted.
      for (const o of s.outcomes()) if (o.status === 'applied' && o.auto) s.undo(o.candidate.id);
      for (const o of s.outcomes()) {
        if (o.status !== 'pending') continue;
        if (o.candidate.replacements.length > 0) tryOr(() => s.accept(o.candidate.id), () => s.reject(o.candidate.id));
        else s.reject(o.candidate.id);
      }
      const json = JSON.stringify(await snapshot(s, VIEW));
      expect(longestSharedRun(json, paras), name).toBeLessThan(12);
    }
  });

  // Task F15 carries a fix under an accepted rewrite across a re-check; a saved review still keeps neither (no AI is saved).
  it('leaves out a fix the user accepted and then an accepted AI rewrite superseded', async () => {
    const POST = 'I recieve post daily.';
    const s = await start([{ id: 0, text: POST }]);
    s.accept(byOriginal(s, 'recieve').id);
    expect(s.addRewrite(0, { start: 0, end: POST.length }, 'Post reaches me daily.', 'I receive post daily.')).toEqual({ ok: true });
    s.accept('llm:0:0-21');
    expect(s.outcomes().find((o) => o.candidate.original === 'recieve')!.status).toBe('superseded');
    expect((await snapshot(s, VIEW)).decisions).toEqual([]);
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
      { id: 1, text: 'I think teh cat is  here.' },
      { id: 2, text: 'She recieved the letter.' },
      { id: 3, text: 'We was very late again.' },
    ];
    const { session, restored, rechecked } = await restore(changed, snap, opts, { linter });
    const status = (original: string) => session.outcomes().find((o) => o.candidate.original === original)!.status;
    expect(status('recieved')).toBe('applied');
    expect(status('  ')).toBe('rejected'); // the undone auto-fix stays undone
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

  it('replays a chosen fix only while it is still the same word: never another suggestion in its place', async () => {
    const paras: Paragraph[] = [{ id: 0, text: 'She recieved the letter.' }];
    const before = await start(paras);
    const flag = byOriginal(before, 'recieved');
    expect(flag.replacements[2]).toBe('receive');
    before.accept(flag.id, 2);
    const snap = await snapshot(before, VIEW);
    expect(JSON.stringify(snap)).not.toContain('receive');

    // A dictionary word changes the suggestions: "recived" now sits where "receive" was.
    const withWord = await createLinter('American', ['recived']);
    const { session, restored } = await restore(paras, snap, { ...opts, dictionary: ['recived'] }, { linter: withWord });
    expect(byOriginal(session, 'recieved').replacements[2]).toBe('recived');
    expect(session.outcomes().find((o) => o.candidate.original === 'recieved')!.status).toBe('pending');
    expect(session.outputText(0)).toBe('She recieved the letter.');
    expect(restored).toBe(0);

    // With the same suggestions it comes back as the same word.
    const same = (await restore(paras, snap, opts, { linter })).session;
    expect(same.outputText(0)).toBe('She receive the letter.');
  });

  // Final F14 review I-3 (owner decision, Task F15): copies paired in order put a decision on the other copy.
  it('a paragraph whose text is found more than once, in the saved review or now, keeps no decision; unique ones keep theirs', async () => {
    const COPY = 'She recieved the letter.';
    const paras: Paragraph[] = [
      { id: 0, text: COPY },
      { id: 1, text: 'We was late again.' },
      { id: 2, text: COPY },
    ];
    const before = await start(paras);
    const [first, second] = before.candidates().filter((c) => c.original === 'recieved');
    before.accept(first.id);
    before.reject(second.id);
    before.reject(byOriginal(before, 'was').id);
    const snap = await snapshot(before, VIEW);
    const statusesOf = (s: CheckSession, original: string) => s.outcomes().filter((o) => o.candidate.original === original).map((o) => o.status);

    // The first copy deleted: its fix never moves onto the copy the user rejected.
    const deleted = await restore([paras[1], { id: 2, text: COPY }], snap, opts, { linter });
    expect(deleted.session.outputText(2)).toBe(COPY);
    expect(statusesOf(deleted.session, 'recieved')).toEqual(['pending']);
    expect(statusesOf(deleted.session, 'was')).toEqual(['rejected']);
    expect(deleted.restored).toBe(1);

    // Both copies still there: neither knows which decision was its own, so both come back for review.
    const same = await restore(paras, snap, opts, { linter });
    expect(statusesOf(same.session, 'recieved')).toEqual(['pending', 'pending']);
    expect(statusesOf(same.session, 'was')).toEqual(['rejected']);
    expect(same.rechecked).toBe(2);
  });

  it('starts with the snapshot depth', async () => {
    const before = await start(PARAS);
    before.setDepth('light');
    const snap: SessionSnapshot = await snapshot(before, VIEW);
    expect((await restore(PARAS, snap, opts, { linter })).session.depth).toBe('light');
  });
});
