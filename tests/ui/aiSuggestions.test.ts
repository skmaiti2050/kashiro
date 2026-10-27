/**
 * On-demand AI suggestions (Task 13 UI) through the controller: "Check how it reads", "Check more sentences",
 * "Improve this sentence", Cancel, "Accept all helper suggestions", stale answers, re-checks, the module switch,
 * and the first-use speed advice. The helper is a mock: nothing here starts llama-server.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Rewriter } from '@/engine/llm/suggest';
import { SessionController, type ControllerDeps, type OpenedFile } from '@/ui/state/sessionController';
import { defaultSettings, type Settings } from '@/ui/state/settings';
import { speedAdvice } from '@/ui/state/helperSpeed';
import { memorySessionFiles } from '../fixtures/memorySessionFiles';
import { english } from './english';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

afterEach(() => {
  vi.useRealTimers();
});

const LONG =
  'The committee members who had been meeting every single week for several months finally agreed after a very long and difficult discussion that the new library should open in the old market building next spring.';
const LONG_REWRITE =
  'The committee members, who had met every week for several months, finally agreed after a long and difficult discussion that the new library should open in the old market building next spring.';
const WAS = 'We was late again.';
const WAS_REWRITE = 'We were late again.';
/** 1,500 words of clean filler: room for 10 decisions and 3 sentences in the first run. */
const FILLER = 'The cat sat on the mat. '.repeat(250).trim();
const TEXT = `${LONG}\n\n${WAS} The bus came at nine.\n\n${FILLER}`;
const FILE: OpenedFile = { name: 'notes.txt', path: '/docs/notes.txt', bytes: new TextEncoder().encode(TEXT) };
const MODEL = 'C:/models/helper.gguf';
/** AI rewrites on, with the model already timed on the mock's CPU build (no speed check gets in the way). */
const AI_ON = {
  modelPath: MODEL,
  modules: { ...DEFAULT_MODULES, aiRewrites: true },
  helperSpeed: { modelPath: MODEL, seconds: 2.5, backend: 'cpu' as const, gpuFallback: false },
};

/** A promise with its resolve function, to hold an answer open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A helper that answers with `answer` (UNCHANGED → null) and records what it was sent. */
function mockHelper(answer: (text: string) => string | null | Promise<string | null> = () => null, backend: 'cpu' | 'vulkan' = 'cpu') {
  const sent: string[] = [];
  const stop = vi.fn();
  const rewriter: Rewriter = {
    async rewrite(text, _preset, _variant, signal) {
      sent.push(text);
      const reply = await answer(text);
      signal.throwIfAborted();
      return reply;
    },
  };
  const startHelper = vi.fn(async () => ({ rewriter, stop, backend, gpuFallback: false }));
  return { sent, stop, startHelper };
}

function makeController(over: Partial<Omit<ControllerDeps, 'settings'>> & { settings?: Partial<Settings> } = {}) {
  const saved: Settings[] = [];
  const controller = new SessionController({
    files: { open: async () => FILE, save: async (path) => ({ path, backup: null }) },
    createLinter: async () => linter,
    saveSettings: async (s) => void saved.push(s),
    ...over,
    settings: { ...defaultSettings('en-US'), preset: 'business', ...AI_ON, ...over.settings },
  });
  return { controller, saved };
}

const session = (c: SessionController) => c.getState().session!;
const suggestions = (c: SessionController) => session(c).candidates().filter((x) => x.source === 'llm');
const statusOf = (c: SessionController, id: string) => session(c).outcomes().find((o) => o.candidate.id === id)!.status;
const announced = (c: SessionController) => english(c.getState().announcement?.message);
/** "Improve this sentence" on the sentence holding `text`. */
const improve = (c: SessionController, text: string) => {
  const p = session(c).paragraphs().find((x) => x.text.includes(text))!;
  c.ai.improveSentence(p.id, p.text.indexOf(text));
};
const textOf = (c: SessionController) =>
  session(c)
    .paragraphs()
    .map((p) => session(c).outputText(p.id))
    .join('\n\n');

describe('nothing runs on its own', () => {
  it('opening a document starts no helper and sends nothing', async () => {
    const helper = mockHelper();
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.open();
    expect(controller.ai.available()).toBe(true);
    expect(helper.startHelper).not.toHaveBeenCalled();
    expect(helper.sent).toEqual([]);
    expect(controller.getState().ai.run).toBeNull();
  });

  it('with AI rewrites off, or no model chosen, there is nothing to offer and nothing starts', async () => {
    const helper = mockHelper();
    for (const settings of [{ modules: DEFAULT_MODULES }, { modelPath: null }]) {
      const { controller } = makeController({ startHelper: helper.startHelper, settings });
      await controller.open();
      expect(controller.ai.available()).toBe(false);
      controller.ai.checkDocument();
      improve(controller, WAS);
      await controller.ai.settled();
    }
    expect(helper.startHelper).not.toHaveBeenCalled();
  });
});

describe('"Check how it reads"', () => {
  it('sends the budgeted sentences one by one, shows progress, and offers each passing rewrite for review', async () => {
    const gate = deferred<void>();
    const helper = mockHelper(async (text) => {
      await gate.promise;
      return text === LONG ? LONG_REWRITE : null;
    });
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.open();
    controller.ai.checkDocument();
    expect(announced(controller)).toMatch(/^Checking how it reads: \d sentences?\.$/);
    const { run } = controller.getState().ai;
    expect(run).toEqual({ done: 0, total: expect.any(Number) });
    expect(run!.total).toBeGreaterThanOrEqual(1);
    expect(run!.total).toBeLessThanOrEqual(3);
    gate.resolve();
    await controller.ai.settled();

    expect(helper.sent).toContain(LONG);
    expect(helper.sent.length).toBe(run!.total);
    const [llm] = suggestions(controller);
    expect(llm.replacements).toEqual([LONG_REWRITE]);
    expect(session(controller).tier(llm.id)).toBe('review');
    expect(statusOf(controller, llm.id)).toBe('pending');
    expect(textOf(controller)).toContain(LONG); // never applied without a click
    expect(controller.getState().ai.run).toBeNull();
    expect(controller.getState().ai.checkedDocument).toBe(true);
    expect(announced(controller)).toBe('AI check finished: 1 suggestion to review.');
  });

  it('progress is announced at the start and the end only, not for every sentence', async () => {
    const helper = mockHelper((text) => (text === LONG ? LONG_REWRITE : null));
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.open();
    // The check's own result ("Check finished: …") was announced before; only the AI's announcements count.
    const seen: string[] = [];
    const before = controller.getState().announcement?.seq;
    controller.subscribe(() => {
      const text = announced(controller);
      if (text && controller.getState().announcement?.seq !== before && seen.at(-1) !== text) seen.push(text);
    });
    controller.ai.checkDocument();
    await controller.ai.settled();
    expect(seen).toHaveLength(2);
  });

  it('"Check more sentences" sends sentences not sent before, beyond the first-run budget', async () => {
    const helper = mockHelper();
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.open();
    controller.ai.checkDocument();
    await controller.ai.settled();
    const first = [...helper.sent];
    controller.ai.checkMore();
    await controller.ai.settled();
    for (const text of helper.sent.slice(first.length)) expect(first).not.toContain(text);
  });

  it('a short document (the depth’s room rounds down to nothing) still gets one sentence checked', async () => {
    const helper = mockHelper();
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS}`); // ~40 words: upFrontRoom is 0
    controller.ai.checkDocument();
    await controller.ai.settled();
    expect(helper.sent).toEqual([LONG]);
    expect(english(controller.getState().ai.notice)).toBeNull();
  });

  it('a review that is really full sends nothing and says so with its count', async () => {
    const helper = mockHelper();
    const { controller } = makeController({ startHelper: helper.startHelper });
    // ~300 words: room for floor(10 * 300 / 1500) = 2 decisions, and more than 2 are open.
    await controller.openText(`${WAS} She recieved the letter. Their going home now.\n\n${LONG}\n\n${'The cat sat on the mat. '.repeat(42).trim()}`);
    const ranked = session(controller).rankedDecisionCount();
    expect(ranked).toBeGreaterThanOrEqual(2);
    controller.ai.checkDocument();
    await controller.ai.settled();
    expect(helper.sent).toEqual([]);
    expect(english(controller.getState().ai.notice)).toBe(
      `Your review already has ${ranked} items, as many as the review depth allows, so nothing was sent. Use “Check more sentences” to go on anyway.`,
    );
    expect(controller.getState().ai.checkedDocument).toBe(true);
    controller.ai.checkMore();
    await controller.ai.settled();
    expect(helper.sent.length).toBeGreaterThan(0);
  });

  it('Cancel keeps the results that already came back', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const helper = mockHelper((text) => (text === LONG ? first.promise : second.promise));
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS}`);
    controller.ai.checkMore(); // 40 words: one sentence, LONG
    await vi.waitFor(() => expect(helper.sent).toEqual([LONG]));
    improve(controller, WAS); // joins the run
    expect(controller.getState().ai.run).toEqual({ done: 0, total: 2 });
    first.resolve(LONG_REWRITE);
    await vi.waitFor(() => expect(helper.sent).toEqual([LONG, WAS]));
    controller.ai.cancel();
    second.resolve(WAS_REWRITE);
    await controller.ai.settled();
    expect(suggestions(controller).map((c) => c.replacements[0])).toEqual([LONG_REWRITE]);
    expect(controller.getState().ai.run).toBeNull();
    expect(announced(controller)).toBe('AI check stopped. 1 suggestion kept.');
  });

  it('a helper failure ends the run with an error and keeps earlier results', async () => {
    const helper = mockHelper((text) => {
      if (text === LONG) return LONG_REWRITE;
      throw new Error('The writing helper answered with HTTP 500.');
    });
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS}`);
    improve(controller, LONG);
    improve(controller, WAS);
    await controller.ai.settled();
    expect(suggestions(controller)).toHaveLength(1);
    expect(english(controller.getState().error)).toContain('HTTP 500');
    expect(controller.getState().ai.run).toBeNull();
  });
});

describe('"Improve this sentence"', () => {
  it('asks about the one sentence; a suggestion is announced and brought up for review', async () => {
    const helper = mockHelper((text) => (text === WAS ? WAS_REWRITE : null));
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS} The bus came at nine.`);
    improve(controller, WAS);
    await controller.ai.settled();
    expect(helper.sent).toEqual([WAS]);
    const [llm] = suggestions(controller);
    expect(llm.replacements).toEqual([WAS_REWRITE]);
    expect(controller.getState().ai.ready).toEqual({ candidateId: llm.id, seq: expect.any(Number) });
    expect(announced(controller)).toBe('AI suggestion ready to review.');
  });

  it('no answer, a punctuation-only one or one the guard stops: "No improvement suggested", and no retry', async () => {
    for (const answer of [null, 'We was, late again.', 'We was perhaps late again.']) {
      const helper = mockHelper(() => answer);
      const { controller } = makeController({ startHelper: helper.startHelper });
      await controller.openText(`${LONG}\n\n${WAS}`);
      improve(controller, WAS);
      await controller.ai.settled();
      expect(suggestions(controller)).toEqual([]);
      expect(english(controller.getState().ai.notice)).toBe('No improvement suggested for this sentence.');
      expect(announced(controller)).toBe('No improvement suggested for this sentence.');
      improve(controller, WAS);
      await controller.ai.settled();
      expect(helper.sent).toEqual([WAS]);
    }
  });

  it('a sentence a rewrite could damage is not sent, and the user is told why', async () => {
    const helper = mockHelper();
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText('This is **bold** text here.');
    improve(controller, 'This is');
    await controller.ai.settled();
    expect(helper.sent).toEqual([]);
    expect(announced(controller)).toMatch(/^This sentence can’t be sent to the AI helper safely/);
  });

  it('a sentence whose suggestion the user already accepted or rejected says so, instead of "No improvement suggested"', async () => {
    for (const decide of ['accept', 'reject'] as const) {
      const helper = mockHelper(() => WAS_REWRITE);
      const { controller } = makeController({ startHelper: helper.startHelper });
      await controller.openText(WAS);
      improve(controller, WAS);
      await controller.ai.settled();
      controller[decide](suggestions(controller)[0].id);
      improve(controller, WAS);
      await controller.ai.settled();
      expect(helper.sent).toEqual([WAS]);
      expect(english(controller.getState().ai.notice)).toBe('You already decided the AI suggestion for this sentence. Undo it in the change log to review it again.');
    }
  });

  it('a sentence with a suggestion waiting brings that suggestion up instead of asking again', async () => {
    const helper = mockHelper(() => WAS_REWRITE);
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(WAS);
    improve(controller, WAS);
    await controller.ai.settled();
    const before = controller.getState().ai.ready!;
    improve(controller, WAS);
    await controller.ai.settled();
    expect(helper.sent).toEqual([WAS]);
    expect(controller.getState().ai.ready).toEqual({ candidateId: before.candidateId, seq: before.seq + 1 });
  });
});

describe('never a stale rewrite', () => {
  it('a sentence edited (a fix accepted in it) after the request was sent never receives the rewrite', async () => {
    const answer = deferred<string | null>();
    const helper = mockHelper(() => answer.promise);
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS}`);
    improve(controller, WAS);
    await vi.waitFor(() => expect(helper.sent).toEqual([WAS]));
    const was = session(controller).candidates().find((c) => c.original.includes('was') && c.replacements.length > 0)!;
    controller.accept(was.id);
    answer.resolve(WAS_REWRITE);
    await controller.ai.settled();
    expect(suggestions(controller)).toEqual([]);
    expect(english(controller.getState().ai.notice)).toBe('The sentence changed while the AI helper worked, so its suggestion was dropped. Ask again if you like.');
  });

  it('after a suggestion is withdrawn (a fix accepted in its sentence), asking again brings up a new card that can be accepted', async () => {
    const helper = mockHelper((text) => (text === WAS ? 'We was late once again.' : 'We were very late again.'));
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS}`);
    improve(controller, WAS);
    await controller.ai.settled();
    const was = session(controller).candidates().find((c) => c.source === 'rules' && c.original.includes('was') && c.replacements.length > 0)!;
    controller.accept(was.id);
    improve(controller, 'We');
    await controller.ai.settled();
    expect(helper.sent).toHaveLength(2);
    const ready = controller.getState().ai.ready!;
    const card = session(controller).outcomes().find((o) => o.candidate.id === ready.candidateId)!;
    expect(card.status).toBe('pending');
    expect(card.candidate.replacements).toEqual(['We were very late again.']);
    controller.accept(card.candidate.id);
    expect(controller.getState().error).toBeNull();
    expect(session(controller).outputText(session(controller).paragraphs()[1].id)).toBe('We were very late again.');
  });

  it('a sentence retyped while its request was out never receives the rewrite', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const answer = deferred<string | null>();
    const helper = mockHelper(() => answer.promise);
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS}`);
    improve(controller, WAS);
    await vi.waitFor(() => expect(helper.sent).toEqual([WAS]));
    controller.editText(`${LONG}\n\nWe was very late again.`);
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    answer.resolve(WAS_REWRITE);
    await controller.ai.settled();
    expect(suggestions(controller)).toEqual([]);
  });

  it('typing elsewhere keeps the suggestions, and an answer on its way still lands on its unchanged sentence', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const answer = deferred<string | null>();
    const helper = mockHelper((text) => (text === LONG ? LONG_REWRITE : answer.promise));
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS}\n\nA third paragraph.`);
    improve(controller, LONG);
    await controller.ai.settled();
    const accepted = suggestions(controller)[0].id;
    controller.accept(accepted);
    improve(controller, WAS);
    await vi.waitFor(() => expect(helper.sent).toEqual([LONG, WAS]));
    controller.editText(`${LONG}\n\n${WAS}\n\nA third paragraph, typed on.`);
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    answer.resolve(WAS_REWRITE);
    await controller.ai.settled();
    expect(textOf(controller).split('\n\n').slice(0, 2)).toEqual([LONG_REWRITE, WAS]);
    expect(suggestions(controller).map((c) => c.replacements[0])).toEqual([LONG_REWRITE, WAS_REWRITE]);
  });
});

describe('a re-check and accepted rewrites (Task F15)', () => {
  const POST = 'I recieve post daily.';
  const POST_REWRITE = 'Post reaches me daily.';
  const helperForPost = () => mockHelper((text) => (text === POST || text === 'I receive post daily.' ? POST_REWRITE : null));
  async function retype(c: SessionController, text: string) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    c.editText(text);
    await vi.advanceTimersByTimeAsync(300);
    await c.settled();
  }

  // Final F14 review I-3 (owner decision): copies paired in order moved the rewrite onto the paragraph just typed.
  it('an accepted rewrite never moves to another paragraph typed to read the same: both copies come back as typed', async () => {
    const helper = helperForPost();
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${POST} Fine.\n\n${POST}`);
    controller.ai.improveSentence(1, 0);
    await controller.ai.settled();
    controller.ai.acceptAll(suggestions(controller).map((c) => c.id));
    expect(textOf(controller)).toBe(`${POST} Fine.\n\n${POST_REWRITE}`);

    await retype(controller, `${POST}\n\n${POST}`);
    expect(textOf(controller)).toBe(`${POST}\n\n${POST}`);
    expect(suggestions(controller)).toEqual([]);
  });
});

describe('"Accept all helper suggestions"', () => {
  it('applies them only on the click, as one change that one undo takes back', async () => {
    const helper = mockHelper((text) => (text === LONG ? LONG_REWRITE : text === WAS ? WAS_REWRITE : null));
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS}`);
    improve(controller, LONG);
    improve(controller, WAS);
    await controller.ai.settled();
    const ids = suggestions(controller).map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(textOf(controller)).toBe(`${LONG}\n\n${WAS}`);
    const decidedBefore = controller.getState().decided;

    controller.ai.acceptAll(ids);
    expect(textOf(controller)).toBe(`${LONG_REWRITE}\n\n${WAS_REWRITE}`);
    expect(controller.getState().decided).toBe(decidedBefore + 2);
    expect(controller.hasUnsavedWork()).toBe(true);
    const batch = session(controller).outcomes().find((o) => o.candidate.id === ids[0])!.batch!;
    controller.undoBatch(batch);
    expect(textOf(controller)).toBe(`${LONG}\n\n${WAS}`);
  });
});

describe('the AI rewrites switch', () => {
  it('switching it off cancels the run, keeps what came back, and stops the helper', async () => {
    const second = deferred<string | null>();
    const helper = mockHelper((text) => (text === LONG ? LONG_REWRITE : second.promise));
    const { controller } = makeController({ startHelper: helper.startHelper });
    await controller.openText(`${LONG}\n\n${WAS}`);
    improve(controller, LONG);
    improve(controller, WAS);
    await vi.waitFor(() => expect(helper.sent).toEqual([LONG, WAS]));
    controller.setModule('aiRewrites', false);
    second.resolve(WAS_REWRITE);
    await controller.settled();
    await controller.ai.settled();
    expect(controller.getState().ai.run).toBeNull();
    expect(helper.stop).toHaveBeenCalledTimes(1);
    expect(controller.ai.available()).toBe(false);
    expect(suggestions(controller).map((c) => c.replacements[0])).toEqual([LONG_REWRITE]);
  });
});

describe('saved reviews never replay AI decisions', () => {
  it('a resumed review has none of the AI suggestions, accepted or not', async () => {
    const disk = memorySessionFiles();
    const helper = mockHelper((text) => (text === LONG ? LONG_REWRITE : text === WAS ? WAS_REWRITE : null));
    const first = makeController({ startHelper: helper.startHelper, sessions: disk.files }).controller;
    await first.openFile(FILE);
    improve(first, LONG);
    improve(first, WAS);
    await first.ai.settled();
    first.accept(suggestions(first)[0].id);
    await first.reviews.flush();

    const second = makeController({ startHelper: helper.startHelper, sessions: disk.files }).controller;
    await second.openFile(FILE);
    await second.reviews.resume();
    expect(suggestions(second)).toEqual([]);
    expect(textOf(second)).toContain(LONG);
    expect(second.getState().ai.checkedDocument).toBe(false);
  });
});

describe('speed advice on first use', () => {
  it('switching AI rewrites on times one sentence once and keeps the result for this model', async () => {
    let now = 0;
    const helper = mockHelper(() => {
      now += 7000;
      return null;
    });
    const { controller, saved } = makeController({ startHelper: helper.startHelper, settings: { modules: DEFAULT_MODULES, helperSpeed: null }, now: () => new Date(now) });
    controller.setModule('aiRewrites', true);
    await controller.ai.settled();
    expect(helper.sent).toHaveLength(1);
    expect(saved.at(-1)!.helperSpeed).toEqual({ modelPath: MODEL, seconds: 7, backend: 'cpu', gpuFallback: false });
    expect(english(speedAdvice(controller.getState().settings))).toBe(
      'This PC is slow for AI rewrites (about 7 s per sentence). Grammar checking doesn’t need it. Use “Improve this sentence” on single sentences.',
    );
    controller.setModule('aiRewrites', false);
    controller.setModule('aiRewrites', true);
    await controller.ai.settled();
    expect(helper.sent).toHaveLength(1);
  });

  it('a fast helper gets no advice; choosing another model times it again', async () => {
    const fast = { modelPath: MODEL, seconds: 2.5, backend: 'vulkan' as const, gpuFallback: false };
    expect(speedAdvice({ ...defaultSettings('en-US'), ...AI_ON, helperSpeed: fast })).toBeNull();
    // Timed for another model file: no advice until this one is timed.
    expect(speedAdvice({ ...defaultSettings('en-US'), ...AI_ON, helperSpeed: { ...fast, seconds: 9, modelPath: 'C:/models/other.gguf' } })).toBeNull();
    const models = { choose: async () => 'C:/models/b.gguf', hash: async () => '0'.repeat(64) };
    const { controller, saved } = makeController({ models, settings: { helperSpeed: fast } });
    await controller.chooseModel();
    expect(saved.at(-1)!.helperSpeed).toBeNull();
  });

  it('a model already timed is not timed again, and "Measuring…" never shows for it', async () => {
    const helper = mockHelper();
    const cached = { modelPath: MODEL, seconds: 2.5, backend: 'cpu' as const, gpuFallback: false };
    const { controller } = makeController({ startHelper: helper.startHelper, settings: { modules: DEFAULT_MODULES, helperSpeed: cached } });
    const measuring: boolean[] = [];
    controller.subscribe(() => measuring.push(controller.getState().ai.measuring));
    controller.setModule('aiRewrites', true);
    await controller.ai.settled();
    expect(measuring).not.toContain(true);
    expect(helper.startHelper).not.toHaveBeenCalled();
  });

  it('timed on the GPU but now running on the CPU: timed again after the next answer', async () => {
    const helper = mockHelper(() => null, 'cpu');
    const onGpu = { modelPath: MODEL, seconds: 2.5, backend: 'vulkan' as const, gpuFallback: false };
    const { controller, saved } = makeController({ startHelper: helper.startHelper, settings: { helperSpeed: onGpu } });
    await controller.openText(WAS);
    improve(controller, WAS);
    await controller.ai.settled();
    expect(helper.sent).toHaveLength(2); // the sentence, then the sample sentence
    expect(saved.at(-1)!.helperSpeed).toMatchObject({ modelPath: MODEL, backend: 'cpu' });
  });

  it('when the GPU build failed and the CPU runs, the advice says so', () => {
    const slow = { modelPath: MODEL, seconds: 6.6, backend: 'cpu' as const, gpuFallback: true };
    expect(english(speedAdvice({ ...defaultSettings('en-US'), ...AI_ON, helperSpeed: slow }))).toBe(
      'This PC is slow for AI rewrites (about 6.6 s per sentence). Grammar checking doesn’t need it. Use “Improve this sentence” on single sentences. The graphics card (GPU) build did not start, so the slower processor (CPU) build is used.',
    );
  });
});
