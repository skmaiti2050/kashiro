import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { adapterFor } from '@/formats/registry';
import type { FormatAdapter } from '@/formats/types';
import { SessionController, type ControllerDeps, type Files, type OpenedFile } from '@/ui/state/sessionController';
import { defaultSettings, type Settings } from '@/ui/state/settings';
import { highlightRanges, locateCandidate } from '@/ui/state/highlights';
import { progressOf } from '@/ui/state/progress';
import { buildDocx } from '../fixtures/make_docx';
import { DEFAULT_MODULES } from '@/engine/modules';
import { english } from './english';

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
    expect(english(doc.note)).toBe('Headers, footers and footnotes are kept as they are but not checked in this version.');
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
    expect(english(controller.getState().error)).toMatch(/^Can’t open bad\.docx: it isn’t a Word document/);
    // What to do next, too (plain language).
    expect(english(controller.getState().error)).toMatch(/Open it in the program that made it and save it as \.docx, \.txt or \.md\.$/);
    expect(controller.getState().phase).toBe('empty');
  });
});

describe('SessionController: broken or unexpected files (Task U3 item 10)', () => {
  const FIXTURES = path.resolve(__dirname, '../fixtures/files');
  const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
  const utf16le = (s: string) => new Uint8Array([0xff, 0xfe, ...[...s].flatMap((ch) => [ch.charCodeAt(0), 0])]);

  const CASES: [string, () => Promise<Uint8Array> | Uint8Array, RegExp][] = [
    ['cut.docx', async () => (await buildDocx('<w:p><w:r><w:t>Hi.</w:t></w:r></w:p>')).slice(0, 120), /^Can’t open cut\.docx: the file is damaged or incomplete\./],
    ['locked.docx', () => fixture('encrypted.docx'), /^Can’t open locked\.docx: it is protected with a password\./],
    ['old.docx', () => fixture('old-word-renamed.docx'), /^Can’t open old\.docx: it is an older Word file \(\.doc\)/],
    ['empty.txt', () => new Uint8Array(), /^empty\.txt is empty: there’s no text to check\./],
    ['blank.docx', () => buildDocx('<w:p/><w:p><w:r><w:t xml:space="preserve">   </w:t></w:r></w:p>'), /^blank\.docx is empty: there’s no text to check\./],
    ['picture.txt', () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), /^Can’t open picture\.txt: it isn’t a text file/],
    ['unicode.txt', () => utf16le('Hello there.'), /^Can’t open unicode\.txt: the text is saved as UTF-16/],
    ['ansi.txt', () => new Uint8Array([...encode('The caf'), 0xe9, ...encode(' was open.')]), /^Can’t open ansi\.txt: the text isn’t saved as UTF-8\./],
    ['huge.txt', () => encode('word '.repeat(1_000_000)), /^huge\.txt is too long to check in one go \(1,000,000 words; the limit is 50,000 words\)\./],
  ];

  it.each(CASES)('%s: a plain message, nothing opened, nothing written', async (name, bytes, message) => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files });
    await controller.openFile({ name, path: `/docs/${name}`, bytes: await bytes() });
    const state = controller.getState();
    expect(english(state.error)).toMatch(message);
    expect(state.phase).toBe('empty');
    expect(state.document).toBeNull();
    expect(saves).toEqual([]);
  });

  it('a broken file leaves the open document as it was', async () => {
    const { controller } = makeController();
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    await controller.openFile({ name: 'locked.docx', path: '/docs/locked.docx', bytes: fixture('encrypted.docx') });
    expect(controller.getState().document!.name).toBe('note.txt');
    expect(controller.getState().phase).toBe('ready');
  });

  it('a 5 MB text file is refused quickly', async () => {
    const { controller } = makeController();
    const bytes = encode('Plain words here. '.repeat(300_000)); // ~5.4 MB
    const t0 = performance.now();
    await controller.openFile({ name: 'big.txt', path: '/docs/big.txt', bytes });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(english(controller.getState().error)).toMatch(/^big\.txt is too long to check in one go/);
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

  const TERMS = 'Each plasmodium has a role. The plasmodium shifts with the season, and a plasmodium can rise.';

  it('acceptTerms adds the terms to the saved personal dictionary', async () => {
    const { controller, saved } = makeController({ createLinter: (v, words) => createLinter(v, words) });
    await controller.openText(TERMS);
    await controller.acceptTerms([]);
    expect(saved.at(-1)!.dictionary).toEqual(['plasmodium']);
    const { top, more } = controller.getState().session!.decisions();
    expect([...top, ...more].find((d) => d.kind === 'terms')).toBeUndefined();
  });

  it('acceptOtherLanguage adds the Indian-language words to the saved personal dictionary', async () => {
    const { controller, saved } = makeController({ createLinter: (v, words) => createLinter(v, words) });
    await controller.openText('He said chalo, and the food was khub bhalo.');
    await controller.acceptOtherLanguage([], ['khub']); // "khub" is one letter from "hub": added only when ticked
    expect(saved.at(-1)!.dictionary).toEqual(['chalo', 'khub', 'bhalo']);
    const { top, more } = controller.getState().session!.decisions();
    expect([...top, ...more].find((d) => d.kind === 'otherLanguage')).toBeUndefined();
  });

  it('acceptOtherLanguage saves a likely typo ("jion", near "join") only when it was ticked', async () => {
    const text = 'He said chalo, and we will jion the bhalo party.';
    const first = makeController({ createLinter: (v, words) => createLinter(v, words) });
    await first.controller.openText(text);
    await first.controller.acceptOtherLanguage([]);
    expect(first.saved.at(-1)!.dictionary).toEqual(['chalo', 'bhalo']);

    const second = makeController({ createLinter: (v, words) => createLinter(v, words) });
    await second.controller.openText(text);
    await second.controller.acceptOtherLanguage([], ['jion']);
    expect(second.saved.at(-1)!.dictionary).toEqual(['chalo', 'jion', 'bhalo']);
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

  it('picking a fallback variant in Settings marks it as chosen, so it outlives a change of Windows region', () => {
    const { controller, saved } = makeController();
    controller.changeSettings({ termMinRepeats: 4 });
    expect(saved.at(-1)!.fallbackVariantChosen).toBe(false);
    controller.changeSettings({ fallbackVariant: 'British' });
    expect(saved.at(-1)).toMatchObject({ fallbackVariant: 'British', fallbackVariantChosen: true });
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
    expect(english(controller.getState().notice)).toBe('Saved as /docs/essay.checked.docx');
  });

  it('clean + overwrite: asks the files module to overwrite the opened path (it backs up first)', async () => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files, settings: { saveMode: 'clean', overwrite: true } });
    await openDocx(controller);
    await controller.save();
    expect(saves[0].path).toBe('/docs/essay.docx');
    expect(saves[0].overwrite).toBe(true);
    expect(english(controller.getState().notice)).toBe('Saved as /docs/essay.docx with a backup at /docs/essay.bak.docx');
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
    expect(english(controller.getState().notice)).toBeNull();
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
    expect(english(controller.getState().notice)).toBe('Saved as /docs/note.checked.txt. 1 change couldn’t be placed: see the change log.');
  });

  it('exportReport saves a Markdown report beside the document', async () => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files });
    await openDocx(controller);
    await controller.exportReport();
    expect(saves[0].path).toBe('/docs/essay.report.md');
    expect(decode(saves[0].bytes)).toMatch(/^# Writing check report: essay\.docx/);
    expect(english(controller.getState().notice)).toBe('Saved the report as /docs/essay.report.md');
  });
});

describe('SessionController: screen-reader announcements', () => {
  const TWO = 'We could of finished it sooner. The data was handwriten.';

  it('a decision is announced with what is left: "Accepted. N of M left."', async () => {
    const { controller } = makeController();
    await controller.openText(TWO);
    expect(controller.getState().announcement).toBeNull();
    const first = controller.getState().session!.decisions().top[0];
    controller.accept(first.id);
    const left = controller.getState().session!.rankedDecisionCount();
    expect(left).toBeGreaterThan(0);
    expect(english(controller.getState().announcement!.message)).toBe(`Accepted. ${left} of ${left + 1} left.`);
  });

  it('reject, a flag dismissed and undo are announced too; each announcement is new', async () => {
    const { controller } = makeController();
    await controller.openText(TWO);
    const [first] = controller.getState().session!.decisions().top;
    controller.reject(first.id);
    const rejected = controller.getState().announcement!;
    expect(english(rejected.message)).toMatch(/^Rejected\. 1 of 2 left\.$/);
    controller.undo(first.candidateIds[0]);
    const undone = controller.getState().announcement!;
    expect(english(undone.message)).toBe('Back to review. 2 of 2 left.');
    expect(undone.seq).toBeGreaterThan(rejected.seq);
  });

  it('a flag with nothing to apply is "Dismissed"', async () => {
    const { controller } = makeController({ settings: { depthByPreset: { academic: 'everything' } } });
    await controller.openText(
      'When the rains came early that year the farmers who had planted their seeds in the low fields along the river found that the ' +
        'water rose faster than anyone in the village had expected and so they moved their animals and their families up the hill ' +
        'to the old temple where they waited for many days.',
    );
    const { top, more } = controller.getState().session!.decisions();
    const flag = [...top, ...more].find((d) => {
      const c = controller.getState().session!.candidates().find((x) => x.id === d.candidateIds[0])!;
      return c.replacements.length === 0;
    });
    expect(flag).toBeDefined();
    controller.reject(flag!.id);
    expect(english(controller.getState().announcement!.message)).toMatch(/^Dismissed\. /);
  });

  it('a card adding words to the dictionary is announced', async () => {
    const { controller } = makeController({ createLinter: (v, words) => createLinter(v, words) });
    await controller.openText('We met Anjali Kulkarni in Nashik today.');
    await controller.acceptNames([]);
    expect(english(controller.getState().announcement!.message)).toMatch(/^Added to your dictionary\. (All reviewed|\d+ of \d+ left)\.$/);
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
    expect(english(controller.getState().error)).toMatch(/disk on fire/);
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

  it('"Review again" on a rejected batch whose paragraph moved still gives back one decision, not one per place', async () => {
    const { controller } = makeController();
    await controller.openText("I can't go. You can't stay.\n\nIt's late.");
    const batch = controller.getState().session!.decisions().top.find((d) => d.kind === 'batch')!;
    controller.reject(batch.id);
    controller.accept(controller.getState().session!.decisions().top.find((d) => d.kind === 'single')!.id);
    expect(controller.getState().decided).toBe(2);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    controller.editText("New start.\n\nI can't go. You can't stay.\n\nIt's late.");
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();

    const rejected = controller.getState().session!.outcomes().filter((o) => o.status === 'rejected' && o.candidate.paraId === 1);
    expect(rejected).toHaveLength(2);
    for (const o of rejected) controller.undo(o.candidate.id);
    expect(controller.getState().decided).toBe(1);
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

describe('SessionController: U1 review flow', () => {
  it('counts the decisions made for the progress header; "Review again" gives one back; a new document starts at 0', async () => {
    const { controller } = makeController();
    await controller.openText("I can't go. It's late.\n\nThe the cat sat.");
    expect(controller.getState().decided).toBe(0);
    const [first, second] = controller.getState().session!.decisions().top;
    controller.accept(first.id);
    controller.reject(second.id);
    expect(controller.getState().decided).toBe(2);
    controller.undo(second.candidateIds[0]); // rejected → back to review
    expect(controller.getState().decided).toBe(1);
    await controller.openText('Fine text.');
    expect(controller.getState().decided).toBe(0);
  });

  it('"N left" counts every ranked decision, not just the up-front queue (so the estimate is honest)', async () => {
    const { controller } = makeController();
    await controller.openText(
      "We can't, won't, don't and doesn't. It isn't, they aren't, he wasn't, we weren't. " +
        "I haven't, she hasn't, we hadn't, it wouldn't, you shouldn't, they couldn't, we mustn't.",
    );
    const session = controller.getState().session!;
    const progress = progressOf(session, 0);
    expect(progress.left).toBe(session.rankedDecisionCount());
    expect(progress.left).toBeGreaterThan(session.decisions().top.length);
  });

  it('applyBatch applies the previewed places as one change; undoBatch takes them back together', async () => {
    const { controller } = makeController();
    await controller.openText("I can't go. You can't stay. We can't eat.");
    const batch = controller.getState().session!.decisions().top.find((d) => d.kind === 'batch')!;
    const [a, , c] = batch.candidateIds;
    controller.applyBatch(batch.id, [a, c]);
    const session = controller.getState().session!;
    expect(session.outputText(0)).toBe("I cannot go. You can't stay. We cannot eat.");
    const batchId = session.outcomes().find((o) => o.candidate.id === a)!.batch!;
    expect(controller.hasUnsavedWork()).toBe(true);
    expect(controller.getState().decided).toBe(1);
    controller.undoBatch(batchId);
    expect(controller.getState().session!.outputText(0)).toBe("I can't go. You can't stay. We can't eat.");
  });

  it('dismissing a rule in this document hides it until another document is opened, and is not saved', async () => {
    const { controller, saved } = makeController();
    await controller.openText(CANT);
    controller.ignoreRule('Contraction', 'document');
    await controller.settled();
    expect(controller.getState().session!.decisionCount()).toBe(0);
    expect(controller.getState().documentIgnoredRules).toEqual(['Contraction']);
    expect(saved.every((s) => s.ignoredRules.length === 0)).toBe(true);
    await controller.openText(CANT);
    expect(controller.getState().session!.decisionCount()).toBe(1);
  });

  it('dismissing a kind already dismissed changes nothing: saved once, counted once', async () => {
    const { controller, saved } = makeController();
    await controller.openText(CANT);
    controller.ignoreRule('Contraction', 'document');
    controller.ignoreRule('Contraction', 'document');
    expect(controller.getState().documentIgnoredRules).toEqual(['Contraction']);
    controller.ignoreRule('Contraction', 'everywhere');
    controller.ignoreRule('Contraction', 'everywhere');
    controller.ignoreRule('Contraction', 'document');
    await controller.settled();
    expect(saved.at(-1)!.ignoredRules).toEqual(['Contraction']);
    expect(controller.getState().decided).toBe(2); // once for this document, once everywhere
  });

  it('"Review again" on places of one rejected batch gives back one decision, not one per place', async () => {
    const { controller } = makeController();
    await controller.openText("I can't go. You can't stay.\n\nIt's late.");
    const { top } = controller.getState().session!.decisions();
    const batch = top.find((d) => d.kind === 'batch')!;
    const single = top.find((d) => d.kind === 'single')!;
    controller.accept(single.id);
    controller.reject(batch.id);
    expect(controller.getState().decided).toBe(2);
    controller.undo(batch.candidateIds[0]);
    controller.undo(batch.candidateIds[1]);
    expect(controller.getState().decided).toBe(1);
  });

  it('dismissing a rule everywhere is saved in settings; Restore brings it back', async () => {
    const { controller, saved } = makeController();
    await controller.openText(CANT);
    controller.ignoreRule('Contraction', 'everywhere');
    await controller.settled();
    expect(saved.at(-1)!.ignoredRules).toEqual(['Contraction']);
    // Announced by its label, not the rule's name.
    expect(english(controller.getState().announcement!.message)).toBe('Dismissed all “Contractions” suggestions everywhere. All reviewed.');
    expect(controller.getState().session!.decisionCount()).toBe(0);
    controller.restoreRule('Contraction');
    await controller.settled();
    expect(saved.at(-1)!.ignoredRules).toEqual([]);
    expect(controller.getState().session!.decisionCount()).toBe(1);
  });

  it('the sample paragraph shows each kind of card: a safe fix, a review, a batch, names and terms', async () => {
    const { controller } = makeController({ settings: { preset: 'business' } });
    await controller.openSample();
    const { document, session } = controller.getState();
    expect(document!.name).toBe('Sample.txt');
    expect(document!.editable).toBe(true);
    expect(session!.outcomes().some((o) => o.auto && o.status === 'applied')).toBe(true);
    const kinds = session!.decisions().top.map((d) => d.kind);
    expect(kinds).toEqual(expect.arrayContaining(['single', 'batch', 'names', 'terms']));
    expect(controller.hasUnsavedWork()).toBe(false);
  });

  it('pending underlines carry their flag (to bring up its card) and their category (to style it)', async () => {
    const { controller } = makeController();
    await controller.openText('We met Anjali today.\n\n' + CANT);
    const { document, session } = controller.getState();
    const pending = highlightRanges(document!, document!.text, session!)!.filter((h) => h.kind === 'pending');
    const byText = pending.map((h) => [document!.text.slice(h.from, h.to), h.category]);
    expect(byText).toEqual([
      ['Anjali', 'names'],
      ["can't", 'style'],
      ["can't", 'style'],
    ]);
    expect(pending.every((h) => session!.candidates().some((c) => c.id === h.candidateId))).toBe(true);
  });

  it('reports "checking" while typed text waits for its re-check, and "up to date" after', async () => {
    const { controller } = makeController();
    await controller.openText('Fine text.');
    expect(controller.getState().checking).toBe(false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    controller.editText('Fine text, more.');
    expect(controller.getState().checking).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    expect(controller.getState().checking).toBe(false);
  });
});

describe('SessionController: modules (U2)', () => {
  const cardKinds = (controller: SessionController) => {
    const { top, more } = controller.getState().session!.decisions();
    return [...top, ...more].map((d) => d.kind);
  };

  it('checks with the saved switches, and switching one re-checks the open document and saves it', async () => {
    const { controller, saved } = makeController({ settings: { modules: { ...DEFAULT_MODULES, namesCard: false } } });
    await controller.openSample();
    expect(controller.getState().session!.modules).toEqual({ ...DEFAULT_MODULES, namesCard: false });
    expect(cardKinds(controller)).not.toContain('names');
    expect(cardKinds(controller)).toContain('terms');
    controller.setModule('termsCard', false);
    await controller.settled();
    expect(cardKinds(controller)).not.toContain('terms');
    expect(saved.at(-1)!.modules).toEqual({ ...DEFAULT_MODULES, namesCard: false, termsCard: false });
  });

  it('a goal with its own modules: switches change only that goal, and turning the override off goes back to the shared ones', async () => {
    const { controller, saved } = makeController(); // preset: academic
    await controller.openSample();
    controller.useModulesForPreset(true);
    controller.setModule('namesCard', false);
    await controller.settled();
    expect(saved.at(-1)!.modulesByPreset).toEqual({ academic: { ...DEFAULT_MODULES, namesCard: false } });
    expect(saved.at(-1)!.modules).toEqual(DEFAULT_MODULES);
    expect(cardKinds(controller)).not.toContain('names');

    controller.setPreset('blog');
    await controller.settled();
    expect(cardKinds(controller)).toContain('names');
    controller.setPreset('academic');
    await controller.settled();
    expect(cardKinds(controller)).not.toContain('names');

    controller.useModulesForPreset(false);
    await controller.settled();
    expect(saved.at(-1)!.modulesByPreset).toEqual({});
    expect(cardKinds(controller)).toContain('names');
  });

  it('word lookup loads the dictionary only while it is on; AI rewrites start no helper while off', async () => {
    const dictionary = { lookup: vi.fn() };
    const loadDictionary = vi.fn(async () => dictionary);
    const startHelper = vi.fn(async () => ({ rewriter: { rewrite: async () => null }, stop: vi.fn(), backend: 'cpu' as const }));
    const { controller } = makeController({ loadDictionary, startHelper });
    expect(await controller.dictionary()).toBe(dictionary);
    expect(controller.helper()).toBeNull(); // off by default
    controller.setModule('wordLookup', false);
    expect(controller.dictionary()).toBeNull();
    controller.setModule('wordLookup', true);
    await controller.dictionary();
    expect(loadDictionary).toHaveBeenCalledTimes(2); // dropped when switched off, loaded again
    expect(startHelper).not.toHaveBeenCalled();
  });

  it('a running helper is stopped when the goal switched to has AI rewrites off', async () => {
    const stop = vi.fn();
    const startHelper = vi.fn(async () => ({ rewriter: { rewrite: async () => null }, stop, backend: 'cpu' as const }));
    const { controller } = makeController({
      startHelper,
      settings: {
        modelPath: 'models/helper.gguf',
        modules: { ...DEFAULT_MODULES, aiRewrites: true },
        modulesByPreset: { blog: { ...DEFAULT_MODULES, aiRewrites: false } },
      },
    });
    await controller.openText(CANT);
    await controller.helper();
    controller.setPreset('blog');
    await controller.settled();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(controller.helper()).toBeNull();
  });

  it('a re-check that fails still stops the helper when AI rewrites were switched off', async () => {
    const stop = vi.fn();
    const startHelper = vi.fn(async () => ({ rewriter: { rewrite: async () => null }, stop, backend: 'cpu' as const }));
    let failing = false;
    const flaky: RulesLinter = {
      get variant() {
        return shared.variant;
      },
      lintParagraphs: (paras, language) => (failing ? Promise.reject(new Error('linter crashed')) : shared.lintParagraphs(paras, language)),
      lintSpelling: (paras, variant) => shared.lintSpelling(paras, variant),
      addWords: (words) => shared.addWords(words),
      setVariant: (variant) => shared.setVariant(variant),
    };
    const { controller } = makeController({
      startHelper,
      createLinter: async () => flaky,
      settings: { modelPath: 'C:/models/helper.gguf', modules: { ...DEFAULT_MODULES, aiRewrites: true } },
    });
    await controller.openText(CANT);
    await controller.helper();
    failing = true;
    controller.setModule('aiRewrites', false);
    await controller.settled();
    expect(controller.getState().error).not.toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('SessionController: the writing helper model', () => {
  const QWEN = 'ff5c3e9740a5aa53f04fdf3b0b8cc75da556bf8948cdb19d61c512d3a43465d9';

  function modelFiles(path: string | null, sha256 = QWEN) {
    return { choose: vi.fn(async () => path), hash: vi.fn(async () => sha256) };
  }

  it('choosing a model file hashes it and stores its path and hash; AI rewrites stay off until switched on', async () => {
    const models = modelFiles('C:/models/Qwen3.5-4B-IQ4_NL.gguf');
    const { controller, saved } = makeController({ models });
    await controller.chooseModel();
    expect(models.hash).toHaveBeenCalledWith('C:/models/Qwen3.5-4B-IQ4_NL.gguf');
    expect(saved.at(-1)).toMatchObject({ modelPath: 'C:/models/Qwen3.5-4B-IQ4_NL.gguf', modelSha256: QWEN });
    expect(controller.getState().checkingModel).toBe(false);
    expect(controller.helper()).toBeNull();
  });

  it('a model file on a network share is refused before it is read', async () => {
    const models = modelFiles('\\\\server\\models\\q.gguf');
    const { controller, saved } = makeController({ models });
    await controller.chooseModel();
    expect(models.hash).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(controller.getState().error).not.toBeNull();
  });

  it('a cancelled choice changes nothing; a file that cannot be read is reported and not stored', async () => {
    const { controller, saved } = makeController({ models: modelFiles(null) });
    await controller.chooseModel();
    expect(saved).toEqual([]);
    const failing = { choose: async () => 'C:/models/x.gguf', hash: async () => Promise.reject(new Error('locked')) };
    const second = makeController({ models: failing });
    await second.controller.chooseModel();
    expect(second.saved).toEqual([]);
    expect(second.controller.getState().error).not.toBeNull();
    expect(second.controller.getState().checkingModel).toBe(false);
  });

  it('choosing another model stops the running helper; the next one starts with the new file', async () => {
    const events: string[] = [];
    const startHelper = vi.fn(async (model: string) => {
      events.push(`start ${model}`);
      return { rewriter: { rewrite: async () => null }, stop: () => void events.push(`stop ${model}`), backend: 'cpu' as const };
    });
    const { controller } = makeController({
      startHelper,
      models: modelFiles('C:/models/b.gguf', '0'.repeat(64)),
      settings: { modelPath: 'C:/models/a.gguf', modules: { ...DEFAULT_MODULES, aiRewrites: true } },
    });
    await controller.helper();
    await controller.chooseModel();
    await controller.settled();
    await controller.helper();
    expect(events).toEqual(['start C:/models/a.gguf', 'stop C:/models/a.gguf', 'start C:/models/b.gguf']);
  });

  it('shows which build runs the helper once it has started, and nothing after AI rewrites go off', async () => {
    const startHelper = vi.fn(async () => ({ rewriter: { rewrite: async () => null }, stop: vi.fn(), backend: 'vulkan' as const }));
    const { controller } = makeController({ startHelper, settings: { modelPath: 'C:/models/a.gguf', modules: { ...DEFAULT_MODULES, aiRewrites: true } } });
    expect(controller.getState().helperBackend).toBeNull();
    await controller.helper();
    expect(controller.getState().helperBackend).toBe('vulkan');
    controller.setModule('aiRewrites', false);
    await controller.settled();
    await Promise.resolve();
    expect(controller.getState().helperBackend).toBeNull();
  });

  it('the warm-up benchmark times one sentence on the started helper; null while AI rewrites are off', async () => {
    const rewrite = vi.fn(async () => null);
    const startHelper = vi.fn(async () => ({ rewriter: { rewrite }, stop: vi.fn(), backend: 'cpu' as const }));
    const off = makeController({ startHelper });
    expect(await off.controller.benchmarkHelper(new AbortController().signal)).toBeNull();
    const { controller } = makeController({ startHelper, settings: { modelPath: 'C:/models/a.gguf', modules: { ...DEFAULT_MODULES, aiRewrites: true } } });
    const result = await controller.benchmarkHelper(new AbortController().signal);
    expect(result).toEqual({ seconds: expect.any(Number), slow: false });
    expect(rewrite).toHaveBeenCalledTimes(1);
  });
});
