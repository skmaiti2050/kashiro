import { describe, it, expect } from 'vitest';
import { SNAPSHOT_VERSION, type SessionSnapshot } from '@/engine/sessionSnapshot';
import { SessionStore, type SavedReview } from '@/ui/state/sessionStore';
import { memorySessionFiles } from '../fixtures/memorySessionFiles';

const SNAP: SessionSnapshot = {
  version: SNAPSHOT_VERSION,
  preset: 'business',
  depth: 'standard',
  variantOverride: null,
  documentIgnoredRules: [],
  paragraphs: ['ab'.repeat(32)],
  decisions: [{ paragraph: 0, kind: 'Spelling', start: 8, end: 11, status: 'applied', replacementHash: '0123456789abcdef' }],
};

const review = (over: Partial<SavedReview> = {}): SavedReview => ({
  name: 'essay.docx',
  path: '/docs/essay.docx',
  updated: '2026-10-01T10:00:00.000Z',
  made: 3,
  left: 7,
  snapshot: SNAP,
  ...over,
});

/** The listed reviews, checking that nothing was reported as unreadable. */
async function reviewsIn(store: SessionStore) {
  const { reviews, problems } = await store.list();
  expect(problems).toEqual([]);
  return reviews;
}

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const PASTED = '0b6e1c2a-5d3f-4e8a-9b1c-2d3e4f5a6b7c';

describe('SessionStore', () => {
  it('saves and loads a review', async () => {
    const store = new SessionStore(memorySessionFiles().files);
    await store.save(KEY_A, review());
    expect(await store.load(KEY_A)).toEqual(review());
    expect(await store.load(KEY_B)).toBeNull();
  });

  it('lists recent reviews newest first: name, path or pasted, updated time, decisions made and left', async () => {
    const store = new SessionStore(memorySessionFiles().files);
    await store.save(KEY_A, review());
    await store.save(PASTED, review({ name: 'Untitled.txt', path: null, updated: '2026-10-02T09:00:00.000Z', made: 1, left: 0, text: 'Pasted words.' }));
    expect(await reviewsIn(store)).toEqual([
      { key: PASTED, name: 'Untitled.txt', path: null, updated: '2026-10-02T09:00:00.000Z', made: 1, left: 0 },
      { key: KEY_A, name: 'essay.docx', path: '/docs/essay.docx', updated: '2026-10-01T10:00:00.000Z', made: 3, left: 7 },
    ]);
  });

  it('a damaged or older-format review is not resumed and not listed', async () => {
    const { files } = memorySessionFiles();
    const store = new SessionStore(files);
    await files.save(KEY_A, '{"name": "half a fi');
    await files.save(KEY_B, JSON.stringify(review({ snapshot: { ...SNAP, version: 0 as typeof SNAPSHOT_VERSION } })));
    await files.save(PASTED, JSON.stringify({ ...review(), made: 'three' }));
    expect(await store.load(KEY_A)).toBeNull();
    expect(await store.load(KEY_B)).toBeNull();
    expect(await reviewsIn(store)).toEqual([]);
    // Version 2 kept a replacement's index, which can name another word later: ignored like any older format.
    await files.save(KEY_A, JSON.stringify(review({ snapshot: { ...SNAP, version: 2 as typeof SNAPSHOT_VERSION } })));
    expect(await store.load(KEY_A)).toBeNull();
  });

  it('a review naming an unknown goal, depth or variant is not resumed: nothing unchecked reaches the settings', async () => {
    const { files } = memorySessionFiles();
    const store = new SessionStore(files);
    const bad = [{ preset: 'hacked' }, { depth: 'deep' }, { variantOverride: 'Martian' }, { documentIgnoredRules: 'Style' }];
    for (const over of bad) {
      await files.save(KEY_A, JSON.stringify(review({ snapshot: { ...SNAP, ...over } as unknown as SessionSnapshot })));
      expect(await store.load(KEY_A), JSON.stringify(over)).toBeNull();
    }
    await files.save(KEY_A, JSON.stringify(review({ snapshot: { ...SNAP, variantOverride: 'British' } })));
    expect((await store.load(KEY_A))!.snapshot.variantOverride).toBe('British');
  });

  it('drops decision entries that are not well formed, and rules that are not text', async () => {
    const { files } = memorySessionFiles();
    const store = new SessionStore(files);
    const good = SNAP.decisions[0];
    const decisions = [
      good,
      { ...good, paragraph: 1 }, // no such paragraph
      { ...good, start: -1 },
      { ...good, start: 12, end: 11 },
      { ...good, end: 2.5 },
      { ...good, status: 'superseded' },
      { ...good, replacementHash: undefined }, // applied, but which fix?
      { ...good, replacementHash: 'receive' }, // a word, not a hash
      { paragraph: 0, kind: 'Spelling', start: 8, end: 11, status: 'applied', replacementIndex: 0 }, // version 2's index
      { ...good, kind: 7 },
      'teh',
      { paragraph: 0, kind: 'Typo', start: 0, end: 3, status: 'rejected' },
      // A change made without a click, undone, then held back as a card by a re-check (final F15 review M-13).
      { paragraph: 0, kind: 'Formatting', start: 4, end: 6, status: 'held' },
    ];
    await files.save(KEY_A, JSON.stringify(review({ snapshot: { ...SNAP, decisions, documentIgnoredRules: ['Style', 3] } as unknown as SessionSnapshot })));
    const loaded = (await store.load(KEY_A))!;
    expect(loaded.snapshot.decisions).toEqual([
      good,
      { paragraph: 0, kind: 'Typo', start: 0, end: 3, status: 'rejected' },
      { paragraph: 0, kind: 'Formatting', start: 4, end: 6, status: 'held' },
    ]);
    expect(loaded.snapshot.documentIgnoredRules).toEqual(['Style']);
  });

  it('a review file that could not be read is reported, and the rest are listed', async () => {
    const { files } = memorySessionFiles();
    const store = new SessionStore(files);
    await store.save(KEY_A, review());
    files.list = async () => ({ sessions: [{ key: KEY_A, json: JSON.stringify(review()) }], problems: [`${KEY_B}.json: stream did not contain valid UTF-8`] });
    expect(await store.list()).toEqual({
      reviews: [{ key: KEY_A, name: 'essay.docx', path: '/docs/essay.docx', updated: '2026-10-01T10:00:00.000Z', made: 3, left: 7 }],
      problems: [`${KEY_B}.json: stream did not contain valid UTF-8`],
    });
  });

  it('prune removes reviews older than the retention; 0 keeps nothing', async () => {
    let now = new Date('2026-10-01T00:00:00Z');
    const { files } = memorySessionFiles(() => now);
    const store = new SessionStore(files);
    await store.save(KEY_A, review());
    now = new Date('2026-10-25T00:00:00Z');
    await store.save(KEY_B, review());
    now = new Date('2026-11-05T00:00:00Z');
    await store.prune(30);
    expect((await reviewsIn(store)).map((r) => r.key)).toEqual([KEY_B]);
    await store.prune(0);
    expect(await reviewsIn(store)).toEqual([]);
  });

  it('delete removes one review', async () => {
    const store = new SessionStore(memorySessionFiles().files);
    await store.save(KEY_A, review());
    await store.save(KEY_B, review());
    await store.delete(KEY_A);
    expect((await reviewsIn(store)).map((r) => r.key)).toEqual([KEY_B]);
  });
});
