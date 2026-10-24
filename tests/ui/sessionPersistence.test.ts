import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import JSZip from 'jszip';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import { SessionController, type ControllerDeps, type Files, type OpenedFile } from '@/ui/state/sessionController';
import { SessionStore } from '@/ui/state/sessionStore';
import { defaultSettings, type Settings } from '@/ui/state/settings';
import { buildDocx } from '../fixtures/make_docx';
import { memorySessionFiles } from '../fixtures/memorySessionFiles';
import { english } from './english';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

afterEach(() => {
  vi.useRealTimers();
});

const encode = (s: string) => new TextEncoder().encode(s);
const TEXT = 'I think teh cat is here.\n\nShe recieved the letter.\n\nWe was late again.';
const FILE: OpenedFile = { name: 'note.txt', path: '/docs/note.txt', bytes: encode(TEXT) };

interface SaveCall {
  path: string;
  bytes: Uint8Array;
}

/** Files that open `toOpen` (recording the folder the dialog was pointed at) and record saves. */
function fakeFiles(toOpen: OpenedFile | null = null) {
  const saves: SaveCall[] = [];
  const opened: (string | undefined)[] = [];
  const files: Files = {
    open: async (defaultPath) => {
      opened.push(defaultPath);
      return toOpen;
    },
    save: async (path, bytes, { overwrite }) => {
      saves.push({ path, bytes });
      return { path, backup: overwrite ? path.replace(/(\.\w+)$/, '.bak$1') : null };
    },
  };
  return { files, saves, opened };
}

/** One app run over `disk` (the app-data session files, which outlive the run). */
function run(disk = memorySessionFiles(), over: Partial<Omit<ControllerDeps, 'settings'>> & { settings?: Partial<Settings> } = {}) {
  const controller = new SessionController({
    files: fakeFiles().files,
    createLinter: async () => linter,
    saveSettings: async () => {},
    sessions: disk.files,
    ...over,
    settings: { ...defaultSettings('en-US'), preset: 'business', ...over.settings },
  });
  return { controller, disk, store: new SessionStore(disk.files) };
}

const decisionOn = (c: SessionController, original: string) => {
  const s = c.getState().session!;
  const id = s.candidates().find((x) => x.original === original)!.id;
  return [...s.decisions().top, ...s.decisions().more].find((d) => d.candidateIds.includes(id))!.id;
};
/** Undoes the "teh" auto-fix: a change of the review, and one that never fails. */
const undoAutoFix = (c: SessionController) => {
  c.undo(c.getState().session!.candidates().find((x) => x.original === 'teh')!.id);
  expect(c.getState().error).toBeNull();
};
const statusOf = (c: SessionController, original: string) =>
  c.getState().session!.outcomes().find((o) => o.candidate.original === original)!.status;

/** Opens FILE, accepts "recieved", rejects "was", and lets the autosave run. */
async function reviewed(disk = memorySessionFiles()) {
  const { controller, store } = run(disk);
  await controller.openFile(FILE);
  controller.accept(decisionOn(controller, 'recieved'));
  controller.reject(decisionOn(controller, 'was'));
  await controller.reviews.flush();
  return { controller, disk, store };
}

describe('saved reviews: autosave', () => {
  it('saves 1 s after the last decision, once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { controller, disk } = run();
    await controller.openFile(FILE);
    controller.accept(decisionOn(controller, 'recieved'));
    await vi.advanceTimersByTimeAsync(600);
    controller.reject(decisionOn(controller, 'was'));
    await vi.advanceTimersByTimeAsync(900);
    expect(disk.stored.size).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    await controller.reviews.flush();
    expect(disk.stored.size).toBe(1);
    const [saved] = [...disk.stored.values()];
    expect(JSON.parse(saved.json)).toMatchObject({ name: 'note.txt', path: '/docs/note.txt', made: 2 });
  });

  it('Close document (Task U3 item 5) writes the waiting review at once and returns to the empty state', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { controller, disk } = run();
    await controller.openFile(FILE);
    controller.accept(decisionOn(controller, 'recieved'));
    expect(disk.stored.size).toBe(0); // the autosave still waits for its pause
    await controller.close();
    expect(disk.stored.size).toBe(1);
    expect(controller.getState()).toMatchObject({ phase: 'empty', document: null, session: null, checking: false });
    expect(controller.hasUnsavedWork()).toBe(false);
    expect(controller.getState().recentReviews.map((r) => r.name)).toEqual(['note.txt']);
  });

  it('never stores the file: no paragraph text in the saved review', async () => {
    const { disk } = await reviewed();
    const [saved] = [...disk.stored.values()];
    for (const paragraph of TEXT.split('\n\n')) expect(saved.json).not.toContain(paragraph);
    expect(JSON.parse(saved.json).text).toBeUndefined();
  });

  it('the key is the SHA-256 of the file bytes plus the path', async () => {
    const { disk } = await reviewed();
    const bytes = new Uint8Array([...FILE.bytes, ...encode(FILE.path!)]);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect([...disk.stored.keys()]).toEqual([hex]);
  });

  it('flush saves a pending change at once (closing the window)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { controller, disk } = run();
    await controller.openFile(FILE);
    controller.accept(decisionOn(controller, 'recieved'));
    await controller.reviews.flush();
    expect(disk.stored.size).toBe(1);
  });

  it('the sample paragraph is not saved', async () => {
    const { controller, disk } = run();
    await controller.openSample();
    controller.accept(controller.getState().session!.decisions().top[0].id);
    await controller.reviews.flush();
    expect(disk.stored.size).toBe(0);
  });

  it('the Saved reviews switch off: nothing is saved, and a saved review is not offered', async () => {
    const { disk } = await reviewed();
    const before = [...disk.stored.values()][0].json;
    const { controller } = run(disk, { settings: { modules: { ...DEFAULT_MODULES, savedSessions: false } } });
    await controller.openFile(FILE);
    expect(controller.getState().resumeOffer).toBeNull();
    undoAutoFix(controller);
    await controller.reviews.flush();
    expect([...disk.stored.values()][0].json).toBe(before);
  });

  it('retention 0: nothing is kept', async () => {
    const { controller, disk } = run(memorySessionFiles(), { settings: { sessionRetentionDays: 0 } });
    await controller.openFile(FILE);
    controller.accept(decisionOn(controller, 'recieved'));
    await controller.reviews.flush();
    expect(disk.stored.size).toBe(0);
  });
});

describe('saved reviews: resume', () => {
  it('reopening the file offers to resume, with the counts: N decisions made, M left', async () => {
    const { disk, controller: first } = await reviewed();
    const left = first.getState().session!.rankedDecisionCount();
    const { controller } = run(disk);
    await controller.openFile(FILE);
    expect(controller.getState().resumeOffer).toEqual({ made: 2, left, changed: false });
  });

  it('Resume restores every decision, the count and the change log; it is announced', async () => {
    const { disk, controller: first } = await reviewed();
    const { controller } = run(disk);
    await controller.openFile(FILE);
    await controller.reviews.resume();
    const state = controller.getState();
    expect(state.resumeOffer).toBeNull();
    expect(statusOf(controller, 'recieved')).toBe('applied');
    expect(statusOf(controller, 'was')).toBe('rejected');
    expect(state.session!.outputText(1)).toBe(first.getState().session!.outputText(1));
    expect(state.decided).toBe(2);
    expect(state.session!.log().filter((e) => !e.auto).map((e) => e.status)).toEqual(['applied', 'rejected']);
    expect(english(state.announcement!.message)).toBe('Review resumed: 2 decisions restored, 0 paragraphs re-checked.');
    expect(controller.hasUnsavedWork()).toBe(true);
  });

  it('Start fresh forgets the saved review', async () => {
    const { disk } = await reviewed();
    const { controller } = run(disk);
    await controller.openFile(FILE);
    await controller.reviews.startFresh();
    expect(controller.getState().resumeOffer).toBeNull();
    expect(statusOf(controller, 'recieved')).toBe('pending');
    expect(controller.getState().decided).toBe(0);
    expect(disk.stored.size).toBe(0);
  });

  it('dismissing the prompt (Escape) neither resumes nor forgets: the saved review stays for next time', async () => {
    const { disk } = await reviewed();
    const before = [...disk.stored.values()][0].json;
    const { controller } = run(disk);
    await controller.openFile(FILE);
    controller.reviews.dismiss();
    expect(controller.getState().resumeOffer).toBeNull();
    expect(statusOf(controller, 'recieved')).toBe('pending');
    undoAutoFix(controller);
    await controller.reviews.flush();
    expect([...disk.stored.values()][0].json).toBe(before);
  });

  it('no autosave while the offer waits: the saved review is not overwritten', async () => {
    const { disk } = await reviewed();
    const before = [...disk.stored.values()][0].json;
    const { controller } = run(disk);
    await controller.openFile(FILE);
    undoAutoFix(controller);
    await controller.reviews.flush();
    expect([...disk.stored.values()][0].json).toBe(before);
  });

  it('a changed file (same path): resume restores unchanged paragraphs and re-checks the rest', async () => {
    const { disk } = await reviewed();
    const oldKey = [...disk.stored.keys()][0];
    const changed: OpenedFile = { ...FILE, bytes: encode('I think teh cat is here.\n\nShe recieved the letter.\n\nWe was very late again.') };
    const { controller } = run(disk);
    await controller.openFile(changed);
    expect(controller.getState().resumeOffer).toMatchObject({ made: 2, changed: true });
    await controller.reviews.resume();
    expect(statusOf(controller, 'recieved')).toBe('applied');
    expect(statusOf(controller, 'was')).toBe('pending');
    expect(english(controller.getState().announcement!.message)).toBe('Review resumed: 1 decision restored, 1 paragraph re-checked.');
    expect(controller.getState().decided).toBe(1);
    // The review moved to the new fingerprint.
    expect(disk.stored.has(oldKey)).toBe(false);
    expect(disk.stored.size).toBe(1);
  });

  it('opening another file saves the first review and does not offer it there', async () => {
    const disk = memorySessionFiles();
    const { controller } = run(disk);
    await controller.openFile(FILE);
    controller.accept(decisionOn(controller, 'recieved'));
    await controller.openFile({ name: 'other.txt', path: '/docs/other.txt', bytes: encode('Teh end.') });
    expect(controller.getState().resumeOffer).toBeNull();
    expect(disk.stored.size).toBe(1);
  });
});

describe('saved reviews: .docx', () => {
  const BODY = '<w:p><w:r><w:t xml:space="preserve">I can\'t go. You can\'t stay.</w:t></w:r></w:p>';
  /** Its contraction rule turns "can't" into "cannot". */
  const ACADEMIC = { preset: 'academic' } as const;
  const documentXmlOf = async (bytes: Uint8Array) => (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');

  it('a resumed .docx review saves its edits as tracked changes, each once', async () => {
    const docx: OpenedFile = { name: 'essay.docx', path: '/docs/essay.docx', bytes: await buildDocx(BODY) };
    const disk = memorySessionFiles();
    const first = run(disk, { settings: ACADEMIC });
    await first.controller.openFile(docx);
    // "can't" twice, as one batch: two edits.
    first.controller.accept(first.controller.getState().session!.decisions().top[0].id);
    await first.controller.reviews.flush();

    const { files, saves } = fakeFiles();
    const { controller } = run(disk, { files, settings: ACADEMIC });
    await controller.openFile(docx);
    await controller.reviews.resume();
    await controller.save();
    const xml = await documentXmlOf(saves[0].bytes);
    expect(saves[0].path).toBe('/docs/essay.checked.docx');
    expect(xml.match(/<w:ins [^>]*w:author="Kashiro"/g)).toHaveLength(2);
    expect(xml.match(/<w:del [^>]*w:author="Kashiro"/g)).toHaveLength(2);
    expect(xml.match(/cannot/g)).toHaveLength(2);
  });

  it('after saving over the .docx with tracked changes, a resume never applies the edit a second time', async () => {
    const docx: OpenedFile = { name: 'essay.docx', path: '/docs/essay.docx', bytes: await buildDocx(BODY) };
    const disk = memorySessionFiles();
    const { files, saves } = fakeFiles();
    const first = run(disk, { files, settings: { ...ACADEMIC, overwrite: true } });
    await first.controller.openFile(docx);
    first.controller.accept(first.controller.getState().session!.decisions().top[0].id);
    await first.controller.save();
    await first.controller.reviews.flush();

    const { controller } = run(disk, { settings: ACADEMIC });
    await controller.openFile({ ...docx, bytes: saves[0].bytes });
    expect(controller.getState().resumeOffer).toMatchObject({ changed: true });
    await controller.reviews.resume();
    expect(controller.getState().session!.acceptedEdits()).toEqual([]);
  });
});

describe('saved reviews: pasted text and the recent list', () => {
  it('pasted text is not kept while "Keep pasted text" is off', async () => {
    const { controller, disk } = run();
    await controller.openText(TEXT);
    controller.accept(decisionOn(controller, 'recieved'));
    await controller.reviews.flush();
    expect(disk.stored.size).toBe(0);
  });

  it('with "Keep pasted text" on, it is saved with its text and resumes from the recent list', async () => {
    const disk = memorySessionFiles();
    const first = run(disk, { settings: { keepPastedText: true } });
    await first.controller.openText(TEXT);
    first.controller.accept(decisionOn(first.controller, 'recieved'));
    await first.controller.reviews.flush();
    const [key] = [...disk.stored.keys()];
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(disk.stored.get(key)!.json).text).toBe(TEXT);

    const { controller } = run(disk, { settings: { keepPastedText: true } });
    await controller.reviews.startUp();
    const [recent] = controller.getState().recentReviews;
    expect(recent).toMatchObject({ key, name: 'Untitled.txt', path: null, made: 1 });
    await controller.reviews.openRecent(recent);
    expect(controller.getState().document!.text).toBe(TEXT);
    expect(controller.getState().resumeOffer).toBeNull();
    expect(statusOf(controller, 'recieved')).toBe('applied');
    controller.reject(decisionOn(controller, 'was'));
    await controller.reviews.flush();
    expect([...disk.stored.keys()]).toEqual([key]);
  });

  it('turning "Keep pasted text" off deletes the pasted text kept', async () => {
    const disk = memorySessionFiles();
    const { controller } = run(disk, { settings: { keepPastedText: true } });
    await controller.openText(TEXT);
    controller.accept(decisionOn(controller, 'recieved'));
    await controller.reviews.flush();
    await controller.reviews.setKeepPastedText(false);
    expect(controller.getState().settings.keepPastedText).toBe(false);
    expect(disk.stored.size).toBe(0);
  });

  it('a file in the recent list opens through the Open dialog at its path and resumes without asking', async () => {
    const { disk } = await reviewed();
    const { files, opened } = fakeFiles(FILE);
    const { controller } = run(disk, { files });
    await controller.reviews.startUp();
    await controller.reviews.openRecent(controller.getState().recentReviews[0]);
    expect(opened).toEqual(['/docs/note.txt']);
    expect(controller.getState().resumeOffer).toBeNull();
    expect(statusOf(controller, 'recieved')).toBe('applied');
  });

  it('start-up prunes reviews past the retention; Delete all removes the rest', async () => {
    let now = new Date('2026-09-01T00:00:00Z');
    const disk = memorySessionFiles(() => now);
    const first = run(disk, { now: () => now });
    await first.controller.openFile(FILE);
    first.controller.accept(decisionOn(first.controller, 'recieved'));
    await first.controller.reviews.flush();
    now = new Date('2026-10-20T00:00:00Z');
    await first.controller.openFile({ ...FILE, name: 'b.txt', path: '/docs/b.txt' });
    first.controller.accept(decisionOn(first.controller, 'recieved'));
    await first.controller.reviews.flush();
    expect(disk.stored.size).toBe(2);

    const { controller } = run(disk, { now: () => now });
    await controller.reviews.startUp();
    expect(controller.getState().recentReviews.map((r) => r.name)).toEqual(['b.txt']);
    await controller.reviews.deleteAll();
    expect(disk.stored.size).toBe(0);
    expect(controller.getState().recentReviews).toEqual([]);
  });

  it('a shorter retention prunes at once', async () => {
    let now = new Date('2026-09-01T00:00:00Z');
    const disk = memorySessionFiles(() => now);
    const { controller } = run(disk, { now: () => now });
    await controller.openFile(FILE);
    controller.accept(decisionOn(controller, 'recieved'));
    await controller.reviews.flush();
    now = new Date('2026-09-10T00:00:00Z');
    await controller.reviews.setRetention(7);
    expect(controller.getState().settings.sessionRetentionDays).toBe(7);
    expect(disk.stored.size).toBe(0);
  });

  it('a failed autosave is shown, not thrown', async () => {
    const disk = memorySessionFiles();
    disk.files.save = async () => {
      throw new Error('disk full');
    };
    const { controller } = run(disk);
    await controller.openFile(FILE);
    controller.accept(decisionOn(controller, 'recieved'));
    expect(await controller.reviews.flush()).toBe(false);
    expect(english(controller.getState().error)).toContain('disk full');
    // Nothing is waiting any more: a second close goes ahead.
    expect(await controller.reviews.flush()).toBe(true);
  });

  it('a saved review file that could not be read is shown at start-up; the rest are listed', async () => {
    const { disk } = await reviewed();
    const list = disk.files.list;
    disk.files.list = async () => ({ ...(await list()), problems: ['0b6e.json: stream did not contain valid UTF-8'] });
    const { controller } = run(disk);
    await controller.reviews.startUp();
    expect(controller.getState().recentReviews).toHaveLength(1);
    expect(english(controller.getState().error)).toContain('0b6e.json: stream did not contain valid UTF-8');
  });
});

describe('saved reviews: fix round 1', () => {
  it('"N decisions restored" counts decisions as the prompt does: a rejected batch of two places is one', async () => {
    const disk = memorySessionFiles();
    const first = run(disk);
    await first.controller.openFile({ ...FILE, bytes: encode('They recieve it.\n\nWe recieve it too.') });
    const batch = first.controller.getState().session!.decisions().top.find((d) => d.candidateIds.length === 2)!;
    first.controller.reject(batch.id);
    await first.controller.reviews.flush();

    const { controller } = run(disk);
    await controller.openFile({ ...FILE, bytes: encode('They recieve it.\n\nWe recieve it too.') });
    expect(controller.getState().resumeOffer).toMatchObject({ made: 1 });
    await controller.reviews.resume();
    expect(english(controller.getState().announcement!.message)).toBe('Review resumed: 1 decision restored, 0 paragraphs re-checked.');
    expect(controller.getState().decided).toBe(1);
  });

  it('a failed resume leaves the goal, the variant and the dismissed rules as they were', async () => {
    const disk = memorySessionFiles();
    const first = run(disk, { settings: { preset: 'academic' } });
    await first.controller.openFile(FILE);
    first.controller.setVariant('British');
    await first.controller.settled();
    first.controller.accept(decisionOn(first.controller, 'recieved'));
    await first.controller.reviews.flush();

    let failing = false;
    const flaky: RulesLinter = { ...linter, variant: linter.variant, lintParagraphs: (p, l) => (failing ? Promise.reject(new Error('checker stopped')) : linter.lintParagraphs(p, l)) };
    const { controller } = run(disk, { createLinter: async () => flaky });
    await controller.openFile(FILE);
    failing = true;
    await controller.reviews.resume();
    const state = controller.getState();
    expect(english(state.error)).toContain('checker stopped');
    expect(state.settings.preset).toBe('business');
    expect(state.variantOverride).toBeNull();
    expect(state.checking).toBe(false);
  });

  it('a recent file that fails to open is not resumed later without asking', async () => {
    const { disk } = await reviewed();
    const { files } = fakeFiles({ name: 'note.xyz', path: '/docs/note.xyz', bytes: FILE.bytes });
    const { controller } = run(disk, { files });
    await controller.reviews.startUp();
    await controller.reviews.openRecent(controller.getState().recentReviews[0]);
    expect(controller.getState().document).toBeNull();
    await controller.openFile(FILE);
    expect(controller.getState().resumeOffer).not.toBeNull();
  });

  it('Delete all also stops saving the open review: it is not recreated at once', async () => {
    const { controller, disk } = await reviewed();
    await controller.reviews.deleteAll();
    undoAutoFix(controller);
    await controller.reviews.flush();
    expect(disk.stored.size).toBe(0);
  });
});

describe('saved reviews: typing while Resume runs (final review I2)', () => {
  const TYPED = TEXT.replace('She recieved', 'Oh. She recieved');
  const TYPED_SAVED = 'I think the cat is here.\n\nOh. She recieved the letter.\n\nWe was late again.';

  /**
   * Reopens the reviewed FILE with a linter whose lint passes wait for `release` (`onlyFirst`: only the next
   * one, the resume's), then clicks Resume and types TYPED; the typed text's pause has passed on return.
   */
  async function typeDuringResume(onlyFirst: boolean) {
    const { disk } = await reviewed(); // "recieved" accepted, "was" rejected
    let gate: Promise<void> | null = null;
    const gated: RulesLinter = {
      ...linter,
      variant: linter.variant,
      lintParagraphs: async (p, l) => {
        const wait = gate;
        if (onlyFirst) gate = null;
        if (wait) await wait;
        return linter.lintParagraphs(p, l);
      },
    };
    const { files, saves } = fakeFiles();
    const { controller } = run(disk, { files, createLinter: async () => gated });
    await controller.openFile(FILE);
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const resuming = controller.reviews.resume();
    controller.editText(TYPED);
    await vi.advanceTimersByTimeAsync(300);
    return { controller, disk, saves, resuming, release };
  }

  const madeOnDisk = (disk: ReturnType<typeof memorySessionFiles>) => [...disk.stored.values()].map((s) => JSON.parse(s.json).made);

  it('the typed text keeps its check and is saved as typed; the review is offered again', async () => {
    const { controller, saves, resuming, release } = await typeDuringResume(false);
    release();
    await resuming;
    await controller.settled();
    expect(await controller.save()).toBe(true);
    expect(new TextDecoder().decode(saves[0].bytes)).toBe(TYPED_SAVED);
    expect(controller.getState().resumeOffer).toMatchObject({ made: 2, changed: true });
    expect(english(controller.getState().announcement!.message)).toBe(
      'The text changed while the review was resuming, so it was not resumed. Choose Resume again to bring your decisions back.',
    );
    // Resumed again on the typed text: the unchanged paragraph's decision comes back.
    await controller.reviews.resume();
    expect(statusOf(controller, 'was')).toBe('rejected');
  });

  it('the typed check finishing first does not autosave over the saved review while the resume runs', async () => {
    const { controller, disk, saves, resuming, release } = await typeDuringResume(true);
    await vi.advanceTimersByTimeAsync(1100); // the typed check is done; its autosave pause passes
    await controller.reviews.flush();
    expect(madeOnDisk(disk)).toEqual([2]);
    release();
    await resuming;
    await vi.advanceTimersByTimeAsync(1100);
    await controller.reviews.flush();
    expect(madeOnDisk(disk)).toEqual([2]);
    expect(controller.getState().resumeOffer).toMatchObject({ made: 2, changed: true });
    expect(await controller.save()).toBe(true);
    expect(new TextDecoder().decode(saves[0].bytes)).toBe(TYPED_SAVED);
  });
});
