/**
 * The worker linter (#19): the main-thread RulesLinter that forwards every call to a Worker running Harper, and
 * replaces that Worker after a crash so one panic doesn't leave the rest of the document unchecked.
 */
import { describe, it, expect, vi } from 'vitest';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { lintInChunks } from '@/engine/chunks';
import type { Candidate, Paragraph, Variant } from '@/engine/types';
import type { LinterRequest } from '@/ui/linterWorker/protocol';
import { serveLinter } from '@/ui/linterWorker/serveLinter';
import { createWorkerLinter, type WorkerLike } from '@/ui/linterWorker/workerLinter';

type CreateLinter = (variant: Variant, words: string[]) => Promise<RulesLinter>;
type FakeWorker = WorkerLike & { requests: LinterRequest[] };

/** A Worker in this process: each one serves its own linter, made by `create` on `start`, and answers asynchronously. */
function fakeWorker(create: CreateLinter): FakeWorker {
  const serve = serveLinter(create);
  let terminated = false;
  const worker: FakeWorker = {
    requests: [],
    onmessage: null,
    onerror: null,
    postMessage(request) {
      worker.requests.push(request);
      void serve(request).then((reply) => {
        if (!terminated) worker.onmessage?.({ data: reply });
      });
    },
    terminate() {
      terminated = true;
    },
  };
  return worker;
}

/** `makeWorker` for createWorkerLinter, keeping every Worker it made. */
function workerMaker(create: CreateLinter) {
  const workers: FakeWorker[] = [];
  const makeWorker = vi.fn(() => {
    const w = fakeWorker(create);
    workers.push(w);
    return w;
  });
  return { workers, makeWorker };
}

function candidateFor(p: Paragraph): Candidate {
  return { id: `${p.id}:0:1:Spelling`, paraId: p.id, span: { start: 0, end: 1 }, original: p.text[0], replacements: [], kind: 'Spelling', message: p.text, source: 'rules' };
}

/**
 * A linter that acts like Harper: once a paragraph containing PANIC has crashed it, every later call throws too.
 * HANG never answers and SLOW answers after 20 ms.
 */
const fakeHarper: CreateLinter = async (variant) => {
  let panicked = false;
  let current = variant;
  return {
    get variant() {
      return current;
    },
    async lintParagraphs(paras) {
      if (panicked || paras.some((p) => p.text.includes('PANIC'))) {
        panicked = true;
        throw new WebAssembly.RuntimeError('unreachable');
      }
      if (paras.some((p) => p.text.includes('HANG'))) await new Promise(() => {});
      if (paras.some((p) => p.text.includes('SLOW'))) await new Promise((resolve) => setTimeout(resolve, 20));
      return paras.map(candidateFor);
    },
    async lintSpelling(paras) {
      return paras.map(candidateFor);
    },
    async addWords() {},
    async setVariant(v) {
      current = v;
    },
  };
};

describe('worker linter', () => {
  it('gives the session the same candidates as the linter itself', async () => {
    const paras = [{ id: 0, text: 'I recieved teh letter.' }, { id: 1, text: 'We met on Tuesday.' }];
    const direct = await createLinter('American');
    const { makeWorker } = workerMaker((v, w) => createLinter(v, w));
    const viaWorker = await createWorkerLinter('American', [], makeWorker);

    expect(await viaWorker.lintParagraphs(paras, 'plaintext')).toEqual(await direct.lintParagraphs(paras, 'plaintext'));
    expect(await viaWorker.lintSpelling(paras, 'British')).toEqual(await direct.lintSpelling(paras, 'British'));
  });

  it('after a crash on one paragraph, a fresh worker checks the next ones (#19)', async () => {
    const { makeWorker } = workerMaker(fakeHarper);
    const linter = await createWorkerLinter('American', [], makeWorker);
    const paras = [{ id: 0, text: 'fine one' }, { id: 1, text: 'PANIC here' }, { id: 2, text: 'fine two' }];
    const unchecked: number[] = [];

    const out = await lintInChunks(paras, (chunk) => linter.lintParagraphs(chunk, 'plaintext'), (p) => unchecked.push(p.id));

    expect(unchecked).toEqual([1]);
    expect(out.map((c) => c.paraId)).toEqual([0, 2]);
    expect(makeWorker).toHaveBeenCalledTimes(3); // start, the chunk failure, the single-paragraph failure
  });

  it('a fresh worker gets the current variant and every word added so far', async () => {
    const { workers, makeWorker } = workerMaker(fakeHarper);
    const linter = await createWorkerLinter('British', ['kashiro'], makeWorker);
    await linter.addWords(['culicifacies']);
    await linter.setVariant('Indian');

    await expect(linter.lintParagraphs([{ id: 0, text: 'PANIC' }], 'plaintext')).rejects.toThrow('unreachable');

    expect(workers).toHaveLength(2);
    expect(workers[1].requests[0]).toEqual({ id: expect.any(Number), op: 'start', variant: 'Indian', words: ['kashiro', 'culicifacies'] });
    expect(linter.variant).toBe('Indian');
  });

  it('a worker that dies fails its pending calls and the next call starts a fresh one', async () => {
    const { workers, makeWorker } = workerMaker(fakeHarper);
    const linter = await createWorkerLinter('American', [], makeWorker);
    const pending = linter.lintParagraphs([{ id: 0, text: 'HANG' }], 'plaintext');
    await vi.waitFor(() => expect(workers[0].requests).toHaveLength(2));

    workers[0].onerror?.(new Error('worker died'));

    await expect(pending).rejects.toThrow('The proofreader restarted; this check was interrupted');
    const next = await linter.lintParagraphs([{ id: 1, text: 'fine' }], 'plaintext');
    expect(next.map((c) => c.paraId)).toEqual([1]);
    expect(workers).toHaveLength(2);
    expect(workers[1].requests.map((r) => r.op)).toEqual(['start', 'lintParagraphs']);
  });

  it('a late reply never answers a newer request', async () => {
    const { makeWorker } = workerMaker(fakeHarper);
    const linter = await createWorkerLinter('American', [], makeWorker);
    const answered: string[] = [];
    const slow = linter.lintParagraphs([{ id: 0, text: 'SLOW' }], 'plaintext').then((c) => (answered.push('slow'), c));
    const quick = linter.lintParagraphs([{ id: 1, text: 'quick' }], 'plaintext').then((c) => (answered.push('quick'), c));

    expect((await slow).map((c) => c.message)).toEqual(['SLOW']);
    expect((await quick).map((c) => c.message)).toEqual(['quick']);
    expect(answered).toEqual(['quick', 'slow']);
  });

  it('a restart whose start fails rejects the waiting calls, and the next call tries a fresh worker', async () => {
    let starts = 0;
    const failingSecondStart: CreateLinter = async (variant, words) => {
      starts += 1;
      if (starts === 2) {
        await new Promise((resolve) => setTimeout(resolve, 20)); // still starting when the next call arrives
        throw new Error('Harper could not load');
      }
      return fakeHarper(variant, words);
    };
    const { workers, makeWorker } = workerMaker(failingSecondStart);
    const linter = await createWorkerLinter('American', [], makeWorker);

    await expect(linter.lintParagraphs([{ id: 0, text: 'PANIC' }], 'plaintext')).rejects.toThrow('unreachable');
    await expect(linter.lintParagraphs([{ id: 1, text: 'fine' }], 'plaintext')).rejects.toThrow('Harper could not load');
    expect(workers).toHaveLength(2); // no retry loop

    const next = await linter.lintParagraphs([{ id: 2, text: 'fine' }], 'plaintext');
    expect(next.map((c) => c.paraId)).toEqual([2]);
    expect(workers).toHaveLength(3);
  });

  it('rejects when the first start fails', async () => {
    const { makeWorker } = workerMaker(async () => {
      throw new Error('Harper could not load');
    });
    await expect(createWorkerLinter('American', [], makeWorker)).rejects.toThrow('Harper could not load');
  });
});
