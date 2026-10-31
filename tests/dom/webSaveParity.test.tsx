// Web Task 3: the web build saves exactly what the desktop app saves. For every tracked .docx fixture, one .md and one
// .txt, the same review (every rule suggestion accepted) saved clean and tracked through the controller writes the
// same bytes under the same suggested name with the web files as with the desktop files. Overwrite on the web says
// first that there's no backup, and saved reviews resume from a file picked again (its name is its path on the web).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Capabilities } from '@/ui/platform/capabilities';
import { files as webFiles } from '@/ui/platform-web/files';
import { msg, type Message } from '@/ui/i18n/message';
import type { Files, OpenedFile, SessionController } from '@/ui/state/sessionController';
import type { Settings } from '@/ui/state/settings';
import { buildDocx } from '../fixtures/make_docx';
import { memorySessionFiles } from '../fixtures/memorySessionFiles';
import { makeController, warmLinter } from './harness';

const DESKTOP: Capabilities = { ai: true, windowMemory: true, updates: true, textDrop: false, saveInPlace: 'native', web: false };
const WEB: Capabilities = { ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'picker', web: true };
const platform = vi.hoisted(() => ({ capabilities: {} as Capabilities }));
vi.mock('@/ui/platform/capabilities', () => platform);

const ROOT = resolve(__dirname, '../..');
/** Tracked .docx fixtures Kashiro refuses to open: both builds must refuse them alike, and write nothing. */
const UNOPENABLE = ['tests/fixtures/files/encrypted.docx', 'tests/fixtures/files/old-word-renamed.docx'];
/** Every .docx in git, one .md and one .txt. */
const FIXTURES = [
  ...UNOPENABLE,
  'trust/reference/academic/midday-meal-attendance.docx',
  'trust/reference/academic/upi-small-merchants.docx',
  'trust/reference/blog/freelancer-taxes.docx',
  'trust/reference/blog/sourdough-bengaluru.docx',
  'trust/reference/blog/village-ganeshotsav-homecoming.docx',
  'trust/reference/business/cloud-migration-proposal.docx',
  'trust/reference/business/q3-sales-review.docx',
  'trust/reference/script/gst-explainer-video.docx',
  'trust/reference/script/short-film-chai-stall.docx',
  'trust/clean/research-summary.md',
  'trust/clean/office-memo.txt',
];
/** Tracked changes carry their time: both builds save at this one. */
const SAVED_AT = new Date('2026-10-31T09:30:00Z');

const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/** One file written by a save: the name it was saved under (no folder) and its bytes. */
interface Written {
  name: string;
  bytes: Uint8Array;
}

/** The desktop's files as the controller sees them: Open gives `file`, Save writes where it suggests. */
function desktopFiles(file: OpenedFile) {
  const written: Written[] = [];
  const files: Files = {
    open: async () => file,
    save: async (path, bytes) => {
      written.push({ name: fileName(path), bytes: new Uint8Array(bytes) });
      return { path, backup: null };
    },
  };
  return { files, written };
}

/**
 * The browser's pickers: Open picks a file named `name` holding `bytes`; Save keeps the suggested name and
 * `written` records it with the bytes. `onSavePicker` runs when the save picker opens.
 */
function installPickers(name: string, bytes: Uint8Array, onSavePicker: () => void = () => {}) {
  const written: Written[] = [];
  const open = async () => [{ getFile: async () => new File([bytes.slice()], name) }];
  const save = async ({ suggestedName }: { suggestedName: string }) => {
    onSavePicker();
    return {
      name: suggestedName,
      createWritable: async () => ({
        write: async (data: Uint8Array) => void written.push({ name: suggestedName, bytes: new Uint8Array(data) }),
        close: async () => {},
      }),
    };
  };
  Object.defineProperty(window, 'showOpenFilePicker', { value: open, configurable: true });
  Object.defineProperty(window, 'showSaveFilePicker', { value: save, configurable: true });
  return written;
}

/** Accepts every rule suggestion (single cards and batches), each decision once. Returns how many were accepted. */
function acceptEveryRuleSuggestion(controller: SessionController): number {
  const accepted = new Set<string>();
  for (;;) {
    const { top, more } = controller.getState().session!.decisions();
    const next = [...top, ...more].find((d) => (d.kind === 'single' || d.kind === 'batch') && !accepted.has(d.id));
    if (!next) return accepted.size;
    accepted.add(next.id);
    controller.accept(next.id);
  }
}

/** Opens the fixture through `files`, accepts every rule suggestion, then saves it clean and tracked. */
async function reviewAndSave(files: Files) {
  const { controller } = makeController({}, files);
  await controller.open();
  const { session, error } = controller.getState();
  if (!session) return { accepted: 0, error };
  const accepted = acceptEveryRuleSuggestion(controller);
  for (const saveMode of ['clean', 'tracked'] as const satisfies Settings['saveMode'][]) {
    controller.changeSettings({ saveMode });
    vi.setSystemTime(SAVED_AT);
    expect(await controller.save()).toBe(true);
  }
  return { accepted, error: controller.getState().error };
}

beforeAll(warmLinter);

afterEach(() => {
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  vi.useRealTimers();
});

describe('the web saves the same bytes under the same name as desktop', () => {
  it.each(FIXTURES)(
    '%s',
    async (fixture) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const bytes = new Uint8Array(readFileSync(resolve(ROOT, fixture)));
      const name = fileName(fixture);

      platform.capabilities = DESKTOP;
      const desktop = desktopFiles({ name, path: `C:\\Docs\\${name}`, bytes });
      const onDesktop = await reviewAndSave(desktop.files);

      platform.capabilities = WEB;
      const onWeb = installPickers(name, bytes);
      const inBrowser = await reviewAndSave(webFiles);

      expect(inBrowser).toEqual(onDesktop);
      expect(onWeb.map((w) => w.name)).toEqual(desktop.written.map((w) => w.name));
      onWeb.forEach((w, i) => expect(w.bytes).toEqual(desktop.written[i].bytes));
      if (UNOPENABLE.includes(fixture)) {
        expect(onDesktop.error).not.toBeNull();
        expect(onWeb).toEqual([]);
        return;
      }
      expect(onDesktop.accepted).toBeGreaterThan(0);
      const checked = name.replace(/\.(\w+)$/, '.checked.$1');
      expect(onWeb.map((w) => w.name)).toEqual([checked, checked]);
    },
    120_000,
  );
});

/** report.docx with one misspelling to accept. */
const reportDocx = () => buildDocx('<w:p><w:r><w:t>She recieved the letter yesterday.</w:t></w:r></w:p>');

describe('Overwrite', () => {
  it('on the web: "No backup on the web" shows before the save picker, which suggests report.docx', async () => {
    platform.capabilities = WEB;
    const { controller } = makeController({ overwrite: true, saveMode: 'clean' }, webFiles);
    let noticeAtPicker: Message | null = null;
    const written = installPickers('report.docx', await reportDocx(), () => (noticeAtPicker = controller.getState().notice));
    await controller.open();
    controller.accept(controller.getState().session!.decisions().top[0].id);
    expect(await controller.save()).toBe(true);
    expect(noticeAtPicker).toEqual(msg('save.webNoBackup'));
    expect(written.map((w) => w.name)).toEqual(['report.docx']);
    expect(controller.getState().notice).toEqual(msg('notice.saved', { path: 'report.docx' }));
  });

  it('on desktop: no such notice (the original is backed up)', async () => {
    platform.capabilities = DESKTOP;
    let noticeAtSave: Message | null = null;
    const { controller } = makeController({ overwrite: true, saveMode: 'clean' }, {
      open: async () => ({ name: 'report.docx', path: 'C:\\Docs\\report.docx', bytes: await reportDocx() }),
      save: async (path) => {
        noticeAtSave = controller.getState().notice;
        return { path, backup: 'C:\\Docs\\report.bak.docx' };
      },
    });
    await controller.open();
    controller.accept(controller.getState().session!.decisions().top[0].id);
    expect(await controller.save()).toBe(true);
    expect(noticeAtSave).toBeNull();
  });

  it('on the web without Overwrite: no notice, and the copy is report.checked.docx', async () => {
    platform.capabilities = WEB;
    const { controller } = makeController({ saveMode: 'clean' }, webFiles);
    let noticeAtPicker: Message | null = null;
    const written = installPickers('report.docx', await reportDocx(), () => (noticeAtPicker = controller.getState().notice));
    await controller.open();
    controller.accept(controller.getState().session!.decisions().top[0].id);
    expect(await controller.save()).toBe(true);
    expect(noticeAtPicker).toBeNull();
    expect(written.map((w) => w.name)).toEqual(['report.checked.docx']);
  });
});

describe('resuming a saved review of a file picked again', () => {
  const body = (second: string) =>
    buildDocx(
      ['I think teh cat is here.', second, 'We was late again.'].map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join(''),
    );

  /** a.docx opened with the web files, two decisions made (one accepted, one rejected), then closed. */
  async function reviewed(disk: ReturnType<typeof memorySessionFiles>, bytes: Uint8Array) {
    platform.capabilities = WEB;
    installPickers('a.docx', bytes);
    const { controller } = makeController({}, webFiles, disk.files);
    await controller.open();
    expect(controller.getState().document?.path).toBe('a.docx');
    const session = controller.getState().session!;
    const idOf = (original: string) => session.candidates().find((c) => c.original === original)!.id;
    controller.accept(idOf('recieved'));
    controller.reject(idOf('was'));
    await controller.reviews.flush();
    await controller.close();
  }

  /** A new visit: Recent reviews › a.docx, with the picker now giving `bytes`. */
  async function reopenFromRecent(disk: ReturnType<typeof memorySessionFiles>, bytes: Uint8Array) {
    installPickers('a.docx', bytes);
    const { controller } = makeController({}, webFiles, disk.files);
    await controller.reviews.startUp();
    const [recent] = controller.getState().recentReviews;
    expect(recent.path).toBe('a.docx');
    await controller.reviews.openRecent(recent);
    return controller;
  }

  it('the same bytes: the two decisions are restored without asking', async () => {
    const disk = memorySessionFiles();
    const bytes = await body('She recieved the letter.');
    await reviewed(disk, bytes);
    const controller = await reopenFromRecent(disk, bytes);
    await vi.waitFor(() => {
      const statusOf = (original: string) => controller.getState().session!.outcomes().find((o) => o.candidate.original === original)?.status;
      expect(statusOf('recieved')).toBe('applied');
      expect(statusOf('was')).toBe('rejected');
    });
    expect(controller.getState().resumeOffer).toBeNull();
  });

  it('different bytes: the "changed since" offer', async () => {
    const disk = memorySessionFiles();
    await reviewed(disk, await body('She recieved the letter.'));
    const controller = await reopenFromRecent(disk, await body('She recieved a parcel.'));
    await vi.waitFor(() => expect(controller.getState().resumeOffer).toMatchObject({ made: 2, changed: true }));
  });
});
