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
  decisions: [{ paragraph: 0, kind: 'Spelling', original: 'teh', start: 8, end: 11, status: 'applied', replacement: 'the' }],
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
    expect(await store.list()).toEqual([
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
    expect(await store.list()).toEqual([]);
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
    expect((await store.list()).map((r) => r.key)).toEqual([KEY_B]);
    await store.prune(0);
    expect(await store.list()).toEqual([]);
  });

  it('delete removes one review', async () => {
    const store = new SessionStore(memorySessionFiles().files);
    await store.save(KEY_A, review());
    await store.save(KEY_B, review());
    await store.delete(KEY_A);
    expect((await store.list()).map((r) => r.key)).toEqual([KEY_B]);
  });
});
