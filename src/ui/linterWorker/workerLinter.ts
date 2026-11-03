import type { RulesLinter } from '../../engine/linter';
import type { Candidate, Variant } from '../../engine/types';
import type { LinterOperation, LinterReply, LinterRequest } from './protocol';

/** The part of a Web Worker this module uses, so tests can run the Worker side in-process. */
export interface WorkerLike {
  postMessage(message: LinterRequest): void;
  terminate(): void;
  onmessage: ((event: { data: LinterReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Why a call failed when another call crashed the Worker, or the Worker itself died. */
const INTERRUPTED = 'The proofreader restarted; this check was interrupted';
/** Why calls fail after `dispose`. */
const CLOSED = 'The proofreader was closed';
/** The first Worker died before it answered `start`: nothing ever ran, so nothing "restarted". */
const START_FAILED = 'The proofreader could not start';

/** START_FAILED with the browser's reason, when the error event carries one (an ErrorEvent's `message`). */
function startFailure(event: unknown): string {
  const reason = (event as { message?: unknown } | null)?.message;
  return typeof reason === 'string' && reason !== '' ? `${START_FAILED} (${reason})` : START_FAILED;
}

interface PendingCall {
  resolve: (candidates: Candidate[] | undefined) => void;
  reject: (error: Error) => void;
}

/**
 * A RulesLinter whose Harper runs in a Worker from `makeWorker`. A Harper panic leaves its WASM unusable, so after
 * any failed call (or a dead Worker) every pending call fails, the Worker is replaced and the new one is started
 * with the current variant and all words added so far (#19). The failed call still rejects, so lintInChunks
 * reports that paragraph unchecked; later calls go to the fresh Worker. Resolves once the first start succeeded.
 */
export async function createWorkerLinter(variant: Variant, words: string[], makeWorker: () => WorkerLike): Promise<RulesLinter> {
  let current = variant;
  const known = [...words];
  const pending = new Map<number, PendingCall>();
  let nextId = 1;
  let worker: WorkerLike;
  /** True until the current Worker has answered its `start`. */
  let starting = true;
  /** Settles when the current Worker's `start` does; calls wait for it, so restarts happen one at a time. */
  let ready: Promise<void>;
  /** A restart's `start` failed: the next call tries one fresh Worker, so a Worker that can't start never loops. */
  let restartOnNextCall = false;
  /** False until the first Worker has answered its `start`. */
  let started = false;
  /** Set by `dispose`: no call is posted and no Worker is started again. */
  let disposed = false;

  const post = (operation: LinterOperation) =>
    new Promise<Candidate[] | undefined>((resolve, reject) => {
      if (disposed) return reject(new Error(CLOSED));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...operation });
    });

  const answer = (reply: LinterReply) => {
    const call = pending.get(reply.id);
    if (!call) return;
    if (!reply.ok) return fail(reply.id, reply.message);
    pending.delete(reply.id);
    call.resolve(reply.candidates);
  };

  /** The restart rule: reject every pending call, terminate the Worker, start a fresh one (unless this was its start). */
  const fail = (failedId: number | undefined, message: string) => {
    // A failed call gets its own message; when the Worker itself died (no failed call), every call gets `message`.
    for (const [id, call] of pending) call.reject(new Error(failedId === undefined || id === failedId ? message : INTERRUPTED));
    pending.clear();
    worker.terminate();
    if (starting) restartOnNextCall = true;
    else launch();
  };

  const launch = () => {
    const w = makeWorker();
    worker = w;
    starting = true;
    // A terminated Worker may still deliver a message; only the current one is listened to.
    w.onmessage = (event) => {
      if (worker === w && !disposed) answer(event.data);
    };
    w.onerror = (event) => {
      if (worker === w && !disposed) fail(undefined, started ? INTERRUPTED : startFailure(event));
    };
    ready = post({ op: 'start', variant: current, words: [...known] }).then(() => {
      starting = false;
      started = true;
    });
    // Calls that wait on `ready` get its error; with no call waiting, the failure is left for the next call.
    ready.catch(() => {});
  };

  const call = async (operation: LinterOperation) => {
    if (disposed) throw new Error(CLOSED);
    if (restartOnNextCall) {
      restartOnNextCall = false;
      launch();
    }
    // A restart may begin while this call waits; wait for that one too, so no call reaches a Worker mid-start.
    let waitedFor: Promise<void>;
    do {
      waitedFor = ready;
      await waitedFor;
    } while (waitedFor !== ready);
    return post(operation);
  };

  launch();
  await ready!;
  return {
    get variant() {
      return current;
    },
    async lintParagraphs(paras, language) {
      return (await call({ op: 'lintParagraphs', paras, language })) ?? [];
    },
    async lintSpelling(paras, v) {
      return (await call({ op: 'lintSpelling', paras, variant: v })) ?? [];
    },
    async addWords(w) {
      known.push(...w); // before the call, so a Worker started after a crash during it still gets them
      await call({ op: 'addWords', words: w });
    },
    async setVariant(v) {
      await call({ op: 'setVariant', variant: v });
      current = v;
    },
    // A Worker is never garbage-collected: without this, every rebuilt linter would leave a loaded Harper behind.
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const waiting of pending.values()) waiting.reject(new Error(CLOSED));
      pending.clear();
      worker.terminate();
    },
  };
}
