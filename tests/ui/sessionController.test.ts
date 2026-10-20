import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import JSZip from 'jszip';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { adapterFor } from '@/formats/registry';
import type { FormatAdapter } from '@/formats/types';
import { SessionController, type ControllerDeps, type Files, type OpenedFile } from '@/ui/state/sessionController';
import { defaultSettings, type Settings } from '@/ui/state/settings';
import { highlightRanges, locateCandidate } from '@/ui/state/highlights';
import { buildDocx } from '../fixtures/make_docx';

let shared: RulesLinter;
let lintCalls = 0;
/** When set, full lint passes wait for it: a check can be held "in flight". */
let lintGate: Promise<void> | null = null;
beforeAll(async () => {
  const real = await createLinter('American');
  // Counts full lint passes, to see when a re-check ran.
  shared = {
    get variant() {
      return real.variant;
    },
    lintParagraphs: async (paras, language) => {
      lintCalls++;
      if (lintGate) await lintGate;
      return real.lintParagraphs(paras, language);
    },
    lintSpelling: (paras, v) => real.lintSpelling(paras, v),
    addWords: (w) => real.addWords(w),
    setVariant: (v) => real.setVariant(v),
  };
});

afterEach(() => {
  vi.useRealTimers();
  lintGate = null;
});

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

interface SaveCall {
  path: string;
  bytes: Uint8Array;
  overwrite: boolean;
}

/**
 * In-memory files module: `open` returns the queued file, `save` records the call and "writes" to the
 * suggested path (an overwrite reports a `.bak` backup beside it).
 */
function fakeFiles(toOpen: OpenedFile | null = null) {
  const saves: SaveCall[] = [];
  const files: Files = {
    open: async () => toOpen,
    save: async (path, bytes, { overwrite }) => {
      saves.push({ path, bytes, overwrite });
      return { path, backup: overwrite ? path.replace(/(\.\w+)$/, '.bak$1') : null };
    },
  };
  return { files, saves };
}

function makeController(over: Partial<Omit<ControllerDeps, 'settings'>> & { settings?: Partial<Settings> } = {}) {
  const saved: Settings[] = [];
  const { files } = over.files ? { files: over.files } : fakeFiles();
  const controller = new SessionController({
    files,
    createLinter: async () => shared,
    saveSettings: async (s) => {
      saved.push(s);
    },
    ...over,
    settings: { ...defaultSettings('en-US'), preset: 'academic', ...over.settings },
  });
  return { controller, saved };
}

const CANT = "I can't go.\n\nYou can't stay.";

describe('SessionController: open and check', () => {
  it('open → the file is checked and its decisions are counted', async () => {
    const { files } = fakeFiles({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    const { controller } = makeController({ files });
    await controller.open();
    const state = controller.getState();
    expect(state.phase).toBe('ready');
    expect(state.document!.name).toBe('note.txt');
    expect(state.document!.text).toBe(CANT);
    expect(state.document!.editable).toBe(true);
    expect(state.session!.decisionCount()).toBe(1); // "can't → cannot" (2 places) is one batch
  });

  it('an empty pasted document is ready and editable', async () => {
    const { controller } = makeController();
    await controller.openText('');
    const state = controller.getState();
    expect(state.phase).toBe('ready');
    expect(state.document).toMatchObject({ name: 'Untitled.txt', path: null, editable: true, text: '' });
    expect(state.session!.decisionCount()).toBe(0);
  });

  it('setDepth for another preset is saved without touching the session', async () => {
    const { controller, saved } = makeController();
    await controller.openText(CANT);
    controller.setDepth('everything', 'blog');
    expect(controller.getState().session!.depth).toBe('standard');
    expect(saved.at(-1)!.depthByPreset).toEqual({ blog: 'everything' });
  });

  it('a text file with a byte-order mark shows its text without it', async () => {
    const { controller } = makeController();
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode(CANT)]);
    await controller.openFile({ name: 'bom.txt', path: '/docs/bom.txt', bytes });
    expect(controller.getState().document!.text).toBe(CANT);
    expect(controller.getState().document!.paraStarts.get(1)).toBe(13);
  });

  it('cancelling the open dialog changes nothing', async () => {
    const { controller } = makeController();
    await controller.open();
    expect(controller.getState().phase).toBe('empty');
  });

  it('a .docx is read-only in the view and carries the "not checked" note; paragraph starts map into the view text', async () => {
    const bytes = await buildDocx('<w:p><w:r><w:t>I think teh cat is here.</w:t></w:r></w:p><w:p><w:r><w:t>Second one.</w:t></w:r></w:p>');
    const { controller } = makeController();
    await controller.openFile({ name: 'essay.docx', path: '/docs/essay.docx', bytes });
    const doc = controller.getState().document!;
    expect(doc.editable).toBe(false);
    expect(doc.note).toBe('Headers, footers and footnotes are kept as they are but not checked in this version.');
    expect(doc.text).toBe('I think teh cat is here.\n\nSecond one.');
    expect(doc.paraStarts.get(1)).toBe(26);
  });

  it('notifies subscribers on every change', async () => {
    const { controller } = makeController();
    const seen: string[] = [];
    const stop = controller.subscribe(() => seen.push(controller.getState().phase));
    await controller.openText('I think teh cat is here.');
    stop();
    expect(seen).toEqual(['checking', 'ready']);
  });

  it('an unreadable file is reported, not thrown', async () => {
    const { controller } = makeController();
    await controller.openFile({ name: 'bad.docx', path: '/docs/bad.docx', bytes: encode('not a zip') });
    expect(controller.getState().error).toMatch(/not a Word document/);
    expect(controller.getState().phase).toBe('empty');
  });
});

describe('SessionController: review', () => {
  it('accept and undo update outputText', async () => {
    const { controller } = makeController();
    await controller.openText(CANT);
    const batch = controller.getState().session!.decisions().top[0];
    controller.accept(batch.id);
    let s = controller.getState().session!;
    expect([s.outputText(0), s.outputText(1)]).toEqual(['I cannot go.', 'You cannot stay.']);

    controller.undo(batch.candidateIds[1]);
    s = controller.getState().session!;
    expect([s.outputText(0), s.outputText(1)]).toEqual(['I cannot go.', "You can't stay."]);
  });

  it('setDepth changes the up-front count and is saved per preset', async () => {
    const { controller, saved } = makeController();
    await controller.openText('He said, "I recieve teh money tommorow and it dont matter." Its fine, its done, its over.');
    controller.setDepth('light');
    expect(controller.getState().session!.depth).toBe('light');
    expect(saved.at(-1)!.depthByPreset.academic).toBe('light');
  });

  it('acceptNames adds the ticked names to the saved personal dictionary', async () => {
    const { controller, saved } = makeController({ createLinter: (v, words) => createLinter(v, words) });
    await controller.openText('We met Anjali Kulkarni in Nashik today.');
    await controller.acceptNames([]);
    expect(saved.at(-1)!.dictionary).toEqual(['Anjali', 'Kulkarni', 'Nashik']);
    const { top, more } = controller.getState().session!.decisions();
    expect([...top, ...more].find((d) => d.kind === 'names')).toBeUndefined();
  });

  const TERMS = 'Each dosha has a role. The dosha shifts with the season, and a dosha can rise.';

  it('acceptTerms adds the terms to the saved personal dictionary', async () => {
    const { controller, saved } = makeController({ createLinter: (v, words) => createLinter(v, words) });
    await controller.openText(TERMS);
    await controller.acceptTerms([]);
    expect(saved.at(-1)!.dictionary).toEqual(['dosha']);
    const { top, more } = controller.getState().session!.decisions();
    expect([...top, ...more].find((d) => d.kind === 'terms')).toBeUndefined();
  });

  it('the terms repeat setting is saved and checks again with it', async () => {
    const { controller, saved } = makeController();
    await controller.openText(TERMS);
    const hasCard = () => controller.getState().session!.decisions().top.some((d) => d.kind === 'terms');
    expect(hasCard()).toBe(true);
    controller.changeSettings({ termMinRepeats: 4 });
    await vi.waitFor(() => expect(hasCard()).toBe(false));
    expect(saved.at(-1)!.termMinRepeats).toBe(4);
  });

  it('removing a dictionary word rebuilds the linter and checks again', async () => {
    const created: string[][] = [];
    const { controller, saved } = makeController({
      settings: { dictionary: ['Anjali', 'Nashik'] },
      createLinter: (v, words) => {
        created.push(words);
        return createLinter(v, words);
      },
    });
    await controller.openText('We met Anjali in Nashik today.');
    expect(controller.getState().session!.decisionCount()).toBe(0);
    await controller.removeWord('Nashik');
    expect(saved.at(-1)!.dictionary).toEqual(['Anjali']);
    expect(created.at(-1)).toEqual(['Anjali']);
    const card = controller.getState().session!.decisions().top.find((d) => d.kind === 'names')!;
    expect(card.label).toBe('1 name or place');
  });
});

describe('SessionController: save', () => {
  const DOCX_BODY = '<w:p><w:r><w:t xml:space="preserve">I can\'t go. You can\'t stay.</w:t></w:r></w:p>';

  async function openDocx(controller: SessionController) {
    await controller.openFile({ name: 'essay.docx', path: '/docs/essay.docx', bytes: await buildDocx(DOCX_BODY) });
    controller.accept(controller.getState().session!.decisions().top[0].id);
  }

  async function documentXmlOf(bytes: Uint8Array): Promise<string> {
    return (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
  }

  it('tracked: writes the accepted edits as tracked changes to name.checked.docx', async () => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files });
    await openDocx(controller);
    await controller.save();
    expect(saves).toHaveLength(1);
    expect(saves[0].path).toBe('/docs/essay.checked.docx');
    expect(saves[0].overwrite).toBe(false);
    const xml = await documentXmlOf(saves[0].bytes);
    expect(xml.match(/<w:ins [^>]*w:author="writing-check"/g)).toHaveLength(2);
    expect(xml).toContain('cannot');
    expect(controller.getState().notice).toBe('Saved /docs/essay.checked.docx');
  });

  it('clean + overwrite: asks the files module to overwrite the opened path (it backs up first)', async () => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files, settings: { saveMode: 'clean', overwrite: true } });
    await openDocx(controller);
    await controller.save();
    expect(saves[0].path).toBe('/docs/essay.docx');
    expect(saves[0].overwrite).toBe(true);
    expect(controller.getState().notice).toBe('Saved /docs/essay.docx (original backed up to /docs/essay.bak.docx)');
    const xml = await documentXmlOf(saves[0].bytes);
    expect(xml).not.toContain('<w:ins');
    expect(xml).toContain('I cannot go. You cannot stay.');
  });

  it('pasted text is saved as a new copy even when overwrite is on', async () => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files, settings: { overwrite: true } });
    await controller.openText(CANT);
    controller.accept(controller.getState().session!.decisions().top[0].id);
    await controller.save();
    expect(saves[0]).toMatchObject({ path: 'Untitled.checked.txt', overwrite: false });
    expect(decode(saves[0].bytes)).toBe('I cannot go.\n\nYou cannot stay.');
  });

  it('a cancelled save dialog leaves no notice', async () => {
    const files: Files = { open: async () => null, save: async () => null };
    const { controller } = makeController({ files });
    await controller.openText(CANT);
    await controller.save();
    expect(controller.getState().notice).toBeNull();
  });

  it('unplaceable edits are marked on the session and shown in the log', async () => {
    const { files, saves } = fakeFiles();
    // A text adapter that refuses the first edit, as the .docx writer does for text it cannot place safely.
    const refusing: FormatAdapter = {
      ...adapterFor('a.txt')!,
      async write(handle, edits, mode) {
        const [first, ...rest] = edits;
        const out = await adapterFor('a.txt')!.write(handle, rest, mode);
        return { bytes: out.bytes, unplaceable: [{ edit: first, reason: 'crosses a field' }] };
      },
    };
    const { controller } = makeController({ files, adapterFor: () => refusing });
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    const batch = controller.getState().session!.decisions().top[0];
    controller.accept(batch.id);
    await controller.save();

    const s = controller.getState().session!;
    const refused = s.outcomes().find((o) => o.candidate.id === batch.candidateIds[0])!;
    expect(refused.unplaceable).toBe('crosses a field');
    expect(s.log().at(-1)!.reason).toBe('unplaceable: crosses a field');
    expect(decode(saves[0].bytes)).toBe("I can't go.\n\nYou cannot stay.");
    expect(controller.getState().notice).toBe("Saved /docs/note.checked.txt; 1 change couldn't be placed (see the change log)");
  });

  it('exportReport saves a Markdown report beside the document', async () => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files });
    await openDocx(controller);
    await controller.exportReport();
    expect(saves[0].path).toBe('/docs/essay.report.md');
    expect(decode(saves[0].bytes)).toMatch(/^# Writing check report: essay\.docx/);
  });
});

describe('SessionController: unsaved work', () => {
  it('open → none; accept → some; save → none; undo → some again', async () => {
    const { controller } = makeController();
    await controller.openText('I think teh cat is here.\n\n' + CANT);
    expect(controller.hasUnsavedWork()).toBe(false); // auto-fixes alone come back on the next check
    const batch = controller.getState().session!.decisions().top[0];
    controller.accept(batch.id);
    expect(controller.hasUnsavedWork()).toBe(true);
    expect(await controller.save()).toBe(true);
    expect(controller.hasUnsavedWork()).toBe(false);
    controller.undo(batch.candidateIds[0]);
    expect(controller.hasUnsavedWork()).toBe(true);
  });

  it('typing, rejecting and adding names count; a cancelled save and a report export do not clear it', async () => {
    const files: Files = { open: async () => null, save: async (path) => (path.endsWith('.md') ? { path, backup: null } : null) };
    const { controller } = makeController({ files, createLinter: (v, words) => createLinter(v, words) });
    await controller.openText('We met Anjali today.');
    await controller.acceptNames([]);
    expect(controller.hasUnsavedWork()).toBe(true);
    expect(await controller.save()).toBe(false);
    await controller.exportReport();
    expect(controller.hasUnsavedWork()).toBe(true);

    await controller.openText(CANT);
    controller.reject(controller.getState().session!.decisions().top[0].id);
    expect(controller.hasUnsavedWork()).toBe(true);
    await controller.openText(CANT);
    controller.editText(CANT + ' More.');
    expect(controller.hasUnsavedWork()).toBe(true);
  });

  it('opening another document starts with nothing unsaved', async () => {
    const { controller } = makeController();
    await controller.openText(CANT);
    controller.accept(controller.getState().session!.decisions().top[0].id);
    await controller.openText('Fine text.');
    expect(controller.hasUnsavedWork()).toBe(false);
  });
});

describe('SessionController: line endings and byte-order mark', () => {
  const BOM = [0xef, 0xbb, 0xbf];
  const CRLF_TEXT = "I can't go.\r\n\r\nYou can't stay.";

  it('a CRLF file keeps CRLF in the view text and tells the editor to use it', async () => {
    const { controller } = makeController();
    await controller.openFile({ name: 'win.txt', path: '/docs/win.txt', bytes: encode(CRLF_TEXT) });
    const doc = controller.getState().document!;
    expect(doc.text).toBe(CRLF_TEXT);
    expect(doc.lineSeparator).toBe('\r\n');
  });

  it('highlights line up with a CRLF document', async () => {
    const { controller } = makeController();
    await controller.openFile({ name: 'win.txt', path: '/docs/win.txt', bytes: encode(CRLF_TEXT) });
    const { document, session } = controller.getState();
    const marks = highlightRanges(document!, document!.text, session!)!;
    expect(marks).not.toBeNull();
    const pending = marks.filter((m) => m.kind === 'pending').map((m) => CRLF_TEXT.slice(m.from, m.to));
    expect(pending).toEqual(["can't", "can't"]);
  });

  it('locateCandidate finds a flag in the view text (CRLF), and gives up on text the session has not seen', async () => {
    const { controller } = makeController();
    await controller.openFile({ name: 'win.txt', path: '/docs/win.txt', bytes: encode(CRLF_TEXT) });
    const { document, session } = controller.getState();
    const second = session!.decisions().top[0].candidateIds[1];
    const candidate = session!.candidates().find((c) => c.id === second)!;
    const at = locateCandidate(document!, document!.text, session!, candidate)!;
    expect(at).toEqual({ from: 19, to: 24 });
    expect(CRLF_TEXT.slice(at.from, at.to)).toBe("can't");
    expect(locateCandidate(document!, CRLF_TEXT + ' More.', session!, candidate)).toBeNull();
  });

  it('highlights are withheld while the view shows other text than the session checked', async () => {
    const { controller } = makeController();
    await controller.openText(CANT);
    const { document, session } = controller.getState();
    expect(highlightRanges(document!, CANT + ' More.', session!)).toBeNull();
  });

  it('typing into a CRLF + BOM file and saving keeps both', async () => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files });
    await controller.openFile({ name: 'win.txt', path: '/docs/win.txt', bytes: new Uint8Array([...BOM, ...encode(CRLF_TEXT)]) });
    // The editor reads its text back with the document's own line separator (sliceDoc).
    controller.editText("I can't go.\r\n\r\nYou can't stay here.");
    controller.accept(controller.getState().session!.decisions().top[0].id);
    await controller.save();
    const bytes = saves[0].bytes;
    expect([...bytes.slice(0, 3)]).toEqual(BOM);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.slice(3))).toBe("I cannot go.\r\n\r\nYou can't stay here.");
  });
});

describe('SessionController: typing re-checks', () => {
  it('a re-check that fails is reported and does not block later saves', async () => {
    const { files, saves } = fakeFiles();
    const text = adapterFor('a.txt')!;
    let reads = 0;
    const failingSecondRead: FormatAdapter = {
      ...text,
      read: async (bytes) => {
        if (++reads === 2) throw new Error('disk on fire');
        return text.read(bytes);
      },
    };
    const { controller } = makeController({ files, adapterFor: () => failingSecondRead });
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    controller.editText(CANT + ' More.');
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    expect(controller.getState().error).toMatch(/disk on fire/);
    await controller.save();
    expect(saves).toHaveLength(1);
  });

  it('a check that finishes after a depth change uses the new depth', async () => {
    const { controller } = makeController();
    await controller.openText(CANT);
    let release!: () => void;
    lintGate = new Promise((r) => (release = r));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    controller.editText(CANT + ' More.');
    await vi.advanceTimersByTimeAsync(300);
    controller.setDepth('light');
    release();
    await controller.settled();
    expect(controller.getState().session!.depth).toBe('light');
  });

  it('re-checks 300 ms after the last keystroke, once', async () => {
    const { controller } = makeController();
    await controller.openText(CANT);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = lintCalls;
    controller.editText("I can't go.\n\nYou can't stay");
    await vi.advanceTimersByTimeAsync(200);
    controller.editText("I can't go.\n\nYou can't stay here.");
    await vi.advanceTimersByTimeAsync(299);
    expect(lintCalls).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    await controller.settled();
    expect(lintCalls).toBe(before + 1);
    expect(controller.getState().document!.text).toBe("I can't go.\n\nYou can't stay here.");
  });

  it('keeps decisions already made on unchanged paragraphs, even when they move', async () => {
    const { controller } = makeController();
    await controller.openText("I can't go.\n\nYou can't stay.\n\nIt's late.");
    const s0 = controller.getState().session!;
    const batch = s0.decisions().top.find((d) => d.kind === 'batch')!;
    controller.accept(batch.id);
    const its = s0.decisions().top.find((d) => d.label.startsWith("It's"))!;
    controller.reject(its.id);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    controller.editText("New start.\n\nI can't go.\n\nYou can't stay here.\n\nIt's late.");
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();

    const s = controller.getState().session!;
    expect(s.outputText(1)).toBe('I cannot go.'); // unchanged, moved from paragraph 0 to 1: still accepted
    expect(s.outputText(2)).toBe("You can't stay here."); // changed: its decision is open again
    expect(s.outputText(3)).toBe("It's late."); // unchanged: still rejected, not offered again
    const pending = [...s.decisions().top, ...s.decisions().more].flatMap((d) => d.candidateIds);
    expect(pending.some((id) => id.startsWith('3:'))).toBe(false);
    expect(pending.some((id) => id.startsWith('2:'))).toBe(true);
  });

  it('an undone auto-fix stays undone after a re-check', async () => {
    const { controller } = makeController();
    await controller.openText('I think teh cat is here.\n\nSecond.');
    const teh = controller.getState().session!.candidates().find((c) => c.original === 'teh')!;
    controller.undo(teh.id);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    controller.editText('I think teh cat is here.\n\nSecond one.');
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    expect(controller.getState().session!.outputText(0)).toBe('I think teh cat is here.');
  });

  it('save waits for a pending re-check', async () => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files });
    await controller.openText('Fine text.');
    controller.editText("I can't go.");
    await controller.save();
    expect(decode(saves[0].bytes)).toBe("I can't go.");
    expect(controller.getState().document!.text).toBe("I can't go.");
  });
});
