/**
 * Task F20 item 6 (owner: "v1.0: yield"): a re-check of a large document ran in one go and froze the panel for
 * 4–5 s. The check now reads the text in chunks of paragraphs and calls an injected `pause` between them (the UI
 * yields to the browser there). The results must be identical; only the timing changes.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { CHUNK_CHARACTERS, chunksOf } from '@/engine/chunks';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Paragraph } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts: CheckOptions = { preset: 'business', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [], modules: DEFAULT_MODULES };

const SENTENCES = [
  'I think teh plan works.',
  'We went to the the market.',
  'He ate a apple. it rained .',
  'The colour of the organised behaviour was odd.',
  'Can we prepone the meeting?',
  'Run sudo apt-get update first.',
  'We will meet  again next week.',
];

/** About 60 paragraphs of mixed slips, well past one chunk. */
const BIG: Paragraph[] = Array.from({ length: 60 }, (_, id) => ({ id, text: `${SENTENCES[id % SENTENCES.length]} ${SENTENCES[(id * 3 + 1) % SENTENCES.length]} Paragraph ${id} ends here.` }));

/** Everything a check produces that the user sees or saves. */
function result(s: CheckSession) {
  const { top, more } = s.decisions();
  return {
    candidates: s.candidates().map((c) => ({ ...c, tier: s.tier(c.id) })),
    decisions: [...top, ...more],
    outcomes: s.outcomes(),
    edits: s.acceptedEdits(),
  };
}

describe('chunksOf', () => {
  it('cuts the paragraphs, in order, into chunks of at most CHUNK_CHARACTERS (a longer paragraph alone)', () => {
    const paras: Paragraph[] = [600, 600, 600, 2000, 10, 10].map((n, id) => ({ id, text: 'x'.repeat(n) }));
    expect(CHUNK_CHARACTERS).toBe(1500);
    expect(chunksOf(paras).map((chunk) => chunk.map((p) => p.id))).toEqual([[0, 1], [2], [3], [4, 5]]);
    expect(chunksOf([])).toEqual([]);
  });
});

describe('a check with a pause between chunks (Task F20 item 6)', () => {
  it('pauses at least once on a large document', async () => {
    const pause = vi.fn(async () => {});
    await CheckSession.start(BIG, opts, { linter, pause });
    expect(BIG.reduce((n, p) => n + p.text.length, 0)).toBeGreaterThan(2 * CHUNK_CHARACTERS);
    expect(pause.mock.calls.length).toBeGreaterThan(1);
  });

  it('finds exactly what a check without pauses finds: candidates, tiers, cards, auto-fixes', async () => {
    const plain = result(await CheckSession.start(BIG, opts, { linter }));
    const paused = result(await CheckSession.start(BIG, opts, { linter, pause: () => new Promise((r) => setTimeout(r, 0)) }));
    expect(paused).toEqual(plain);
    expect(plain.decisions.length).toBeGreaterThan(2);
    expect(plain.candidates.length).toBeGreaterThan(60);
  });

  it('stops when the pause throws (a newer check superseded it)', async () => {
    let calls = 0;
    const stop = new Error('superseded');
    const pause = async () => {
      if (++calls === 2) throw stop;
    };
    await expect(CheckSession.start(BIG, opts, { linter, pause })).rejects.toBe(stop);
    expect(calls).toBe(2);
  });
});
