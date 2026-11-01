import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { CheckSession } from '@/engine/session';
import { adapterFor } from '@/formats/registry';
import type { FormatAdapter } from '@/formats/types';
import { SessionController, type ControllerDeps, type Files, type OpenedFile } from '@/ui/state/sessionController';
import { defaultSettings, type Settings } from '@/ui/state/settings';
import { SaveOverOriginalError } from '@/ui/state/saveFlow';
import { highlightRanges, locateCandidate } from '@/ui/state/highlights';
import { progressOf } from '@/ui/state/progress';
import { buildDocx } from '../fixtures/make_docx';
import { DEFAULT_MODULES } from '@/engine/modules';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
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
    // The first change is "Opening…" (still the empty phase), then the check.
    expect(seen).toEqual(['empty', 'checking', 'ready']);
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
    ['huge.txt', () => encode('word '.repeat(60_000)), /^huge\.txt is too long to check in one go \(60,000 words; the limit is 50,000 words\)\./],
    // Task U3 fix 1: one paragraph's check time grows with the square of its flags.
    [
      'one-paragraph.txt',
      () => encode('Plain words here. '.repeat(1500)),
      /^one-paragraph\.txt has a paragraph too long to check \(27,000 characters; the limit is 20,000\)\. Break it into shorter paragraphs/,
    ],
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

  it('an error and a notice can each be dismissed (Task U3 item 5)', async () => {
    const { controller } = makeController();
    await controller.openFile({ name: 'locked.docx', path: '/docs/locked.docx', bytes: fixture('encrypted.docx') });
    controller.dismissError();
    expect(controller.getState().error).toBeNull();
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    await controller.save();
    expect(english(controller.getState().notice)).toMatch(/^Saved as /);
    controller.dismissNotice();
    expect(controller.getState().notice).toBeNull();
  });

  it('a broken file leaves the open document as it was', async () => {
    const { controller } = makeController();
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    await controller.openFile({ name: 'locked.docx', path: '/docs/locked.docx', bytes: fixture('encrypted.docx') });
    expect(controller.getState().document!.name).toBe('note.txt');
    expect(controller.getState().phase).toBe('ready');
  });

  it('a 5 MB text file is refused by its size, before it is decoded', async () => {
    const { controller } = makeController();
    const bytes = encode('Plain words here. '.repeat(300_000)); // ~5.4 MB
    const t0 = performance.now();
    await controller.openFile({ name: 'big.txt', path: '/docs/big.txt', bytes });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(english(controller.getState().error)).toMatch(/^big\.txt is too large to check \(5\.4 MB; text files can be up to 2 MB\)\./);
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
    expect(saved.at(-1)!.dictionary).toEqual(['anjali', 'kulkarni', 'nashik']); // title case is stored in lowercase (F29)
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
      settings: { dictionary: ['anjali', 'nashik'] },
      createLinter: (v, words) => {
        created.push(words);
        return createLinter(v, words);
      },
    });
    await controller.openText('We met Anjali in Nashik today.');
    expect(controller.getState().session!.decisionCount()).toBe(0);
    await controller.removeWord('nashik');
    expect(saved.at(-1)!.dictionary).toEqual(['anjali']);
    expect(created.at(-1)).toEqual(['anjali']);
    const card = controller.getState().session!.decisions().top.find((d) => d.kind === 'names')!;
    expect(card.label).toBe('1 name or place');
  });
});

describe('SessionController: the Dictionary panel (F22 item 1)', () => {
  it('Add with no document: saved as withWordAdded stores it (one entry per word, composed), and the next linter has it', async () => {
    const created: string[][] = [];
    const { controller, saved } = makeController({
      settings: { dictionary: ['VANTIX', 'NASHIK'] },
      createLinter: (v, words) => {
        created.push(words);
        return createLinter(v, words);
      },
    });
    await controller.addDictionaryWord('  vantix ');
    expect(saved.at(-1)!.dictionary).toEqual(['NASHIK', 'vantix']);
    await controller.addDictionaryWord('Café');
    // Composed, and in lowercase: title case (Task F29).
    expect(saved.at(-1)!.dictionary).toEqual(['NASHIK', 'vantix', 'café']);
    await controller.addDictionaryWord('   ');
    expect(saved.at(-1)!.dictionary).toEqual(['NASHIK', 'vantix', 'café']);
    await controller.openText('We met Anjali in Nashik today.');
    expect(created.at(-1)).toEqual(['NASHIK', 'vantix', 'café']);
  });

  it('Add with a document open: its flags go, as a card’s Add to dictionary', async () => {
    const { controller, saved } = makeController({ createLinter: (v, words) => createLinter(v, words) });
    await controller.openText('We met Anjali in Nashik today.');
    const flagged = () => controller.getState().session!.decisions().top.some((d) => d.kind === 'names');
    expect(flagged()).toBe(true);
    await controller.addDictionaryWord('Anjali');
    await controller.addDictionaryWord('Nashik');
    expect(flagged()).toBe(false);
    expect(saved.at(-1)!.dictionary).toEqual(['anjali', 'nashik']); // title case is stored in lowercase (F29)
  });

  it('Merge duplicates: the merged list is saved and checked with; it says how many; nothing else changes', async () => {
    const created: string[][] = [];
    // No title-case entry: those are lowercased on load (Task F29), which merges them before the button can.
    const OWNER = ['VANTIX', 'vantix', 'VPC', 'vpc', 'AMI'];
    const { controller, saved } = makeController({
      settings: { dictionary: OWNER },
      createLinter: (v, words) => {
        created.push(words);
        return createLinter(v, words);
      },
    });
    await controller.openText('We met Vantix in Nashik about the VPC.');
    const before = controller.getState();
    expect(await controller.mergeDictionaryDuplicates()).toBe(2);
    const after = controller.getState();
    expect(saved.at(-1)!.dictionary).toEqual(['vantix', 'vpc', 'AMI']);
    expect({ ...saved.at(-1)!, dictionary: OWNER }).toEqual(before.settings);
    expect(created.at(-1)).toEqual(['vantix', 'vpc', 'AMI']);
    expect(after.document!.text).toBe(before.document!.text);
    expect(after.session!.decisionCount()).toBe(before.session!.decisionCount());
    expect(await controller.mergeDictionaryDuplicates()).toBe(0);
  });
});

describe('SessionController: title-case words are stored in lowercase (Task F29)', () => {
  const withRealLinter = (dictionary: string[] = []) => makeController({ settings: { dictionary }, createLinter: (v, words) => createLinter(v, words) });

  it('Dictionary › Add with no document stores "Cutover" as "cutover" and keeps "ARN", "DBInstances" and "DNSName"', async () => {
    const { controller, saved } = withRealLinter();
    for (const word of ['Cutover', 'ARN', 'DBInstances', 'DNSName']) await controller.addDictionaryWord(word);
    expect(saved.at(-1)!.dictionary).toEqual(['cutover', 'ARN', 'DBInstances', 'DNSName']);
  });

  it('Dictionary › Add with a document open stores the same forms, and "cutover" is flagged in no case', async () => {
    const { controller, saved } = withRealLinter();
    await controller.openText('Cutover is tonight. The cutover runs late.');
    expect(controller.getState().session!.decisionCount()).toBeGreaterThan(0);
    for (const word of ['Cutover', 'ARN', 'DBInstances', 'DNSName']) await controller.addDictionaryWord(word);
    expect(saved.at(-1)!.dictionary).toEqual(['cutover', 'ARN', 'DBInstances', 'DNSName']);
    expect(controller.getState().session!.decisionCount()).toBe(0);
  });

  it('a card’s Add to dictionary stores the title-case word in lowercase', async () => {
    const { controller, saved } = withRealLinter();
    await controller.openText('Cutover is tonight.');
    const session = controller.getState().session!;
    const flag = session.candidates().find((c) => c.original === 'Cutover' && (c.kind === 'Spelling' || c.kind === 'Typo'))!;
    const decision = [...session.decisions().top, ...session.decisions().more].find((d) => d.candidateIds.includes(flag.id))!;
    await controller.addToDictionary(decision.id);
    expect(saved.at(-1)!.dictionary).toEqual(['cutover']);
  });

  it('the names card stores names in lowercase', async () => {
    const { controller, saved } = withRealLinter();
    await controller.openText('We met Anjali Kulkarni in Nashik today.');
    await controller.acceptNames([]);
    expect(saved.at(-1)!.dictionary).toEqual(expect.arrayContaining(['anjali', 'kulkarni', 'nashik']));
    expect(saved.at(-1)!.dictionary.every((w) => w === w.toLowerCase())).toBe(true);
  });

  it('a saved dictionary with title-case entries is lowercased once on load and saved; without any, nothing is saved', () => {
    const { controller, saved } = withRealLinter(['Cutover', 'ARN', 'vantix', 'DBInstances']);
    expect(controller.getState().settings.dictionary).toEqual(['cutover', 'ARN', 'vantix', 'DBInstances']);
    expect(saved.map((s) => s.dictionary)).toEqual([['cutover', 'ARN', 'vantix', 'DBInstances']]);
    expect(withRealLinter(['ARN', 'vantix']).saved).toEqual([]);
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
    expect(xml.match(/<w:ins [^>]*w:author="Kashiro"/g)).toHaveLength(2);
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
    expect(decode(saves[0].bytes)).toMatch(/^# Kashiro report: essay\.docx/);
    expect(english(controller.getState().notice)).toBe('Saved the report as /docs/essay.report.md');
  });
});

describe('SessionController: screen-reader announcements', () => {
  const TWO = 'We could of finished it sooner. The data was handwriten.';

  it('a decision is announced with what is left: "Accepted. N of M left."', async () => {
    const { controller } = makeController();
    await controller.openText(TWO);
    const found = controller.getState().session!.rankedDecisionCount();
    expect(english(controller.getState().announcement!.message)).toBe(`Check finished: ${found} suggestions to decide.`);
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
    await controller.close(); // drops the typing pause, so its re-check can't run during a later test
  });

  it('a copy refused over the open document says so, passes the original to the save, and leaves the work unsaved (review #4)', async () => {
    const originals: (string | null | undefined)[] = [];
    const files: Files = {
      open: async () => null,
      save: async (_path, _bytes, { original }) => {
        originals.push(original);
        throw new SaveOverOriginalError('/docs/note.txt');
      },
    };
    const { controller } = makeController({ files });
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    controller.accept(controller.getState().session!.decisions().top[0].id);
    expect(await controller.save()).toBe(false);
    expect(originals).toEqual(['/docs/note.txt']);
    expect(english(controller.getState().error)).toBe(
      'Not saved: note.txt is the document you opened, and a copy never replaces it. Choose another name, or turn on “Overwrite (keeps a backup)” in Save options.',
    );
    expect(controller.hasUnsavedWork()).toBe(true);
    await controller.exportReport();
    expect(originals).toEqual(['/docs/note.txt', '/docs/note.txt']);
    expect(english(controller.getState().error)).toMatch(/^Not saved: note\.txt is the document you opened/);
  });

  it('text typed while a save is being written stays unsaved, so closing still asks first', async () => {
    let finishWrite!: () => void;
    const writing = new Promise<void>((r) => (finishWrite = r));
    let started = false;
    const files: Files = {
      open: async () => null,
      save: async (path) => {
        started = true;
        await writing;
        return { path, backup: null };
      },
    };
    const { controller } = makeController({ files });
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    controller.accept(controller.getState().session!.decisions().top[0].id);
    const saving = controller.save();
    await vi.waitFor(() => expect(started).toBe(true)); // the file is being written
    controller.editText(`${CANT} More.`);
    finishWrite();
    expect(await saving).toBe(true);
    expect(controller.hasUnsavedWork()).toBe(true);
    await controller.close(); // drops the typing pause, so its re-check can't run during a later test
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

  it('a re-check that throws after typing refuses the save, so the old edits never land in the new text (final review I1)', async () => {
    const { files, saves } = fakeFiles();
    let failing = false;
    const flaky: RulesLinter = {
      ...shared,
      variant: shared.variant,
      lintParagraphs: (p, l) => (failing ? Promise.reject(new Error('checker stopped')) : shared.lintParagraphs(p, l)),
    };
    const { controller } = makeController({ files, createLinter: async () => flaky });
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    controller.accept(controller.getState().session!.decisions().top[0].id); // can't → cannot, both places
    failing = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const typed = `Hi there. ${CANT}`;
    controller.editText(typed);
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    const checkError = english(controller.getState().error);
    const saved = await controller.save();
    expect(saves.map((s) => decode(s.bytes))).toEqual([]);
    expect(saved).toBe(false);
    // Both refusals say what to do if the check keeps failing (final re-review m2).
    expect(english(controller.getState().error)).toMatch(/^Not saved: the text changed after its last check/);
    expect(english(controller.getState().error)).toMatch(/If the check keeps failing, copy your text somewhere safe, then close the document\. Your file on disk is unchanged\.$/);
    expect(checkError).toBe(
      'The check failed: checker stopped. Nothing can be saved until the text is checked: edit the text to try again. ' +
        'If it keeps failing, copy your text somewhere safe, then close the document. Your file on disk is unchanged.',
    );
    // A check that works again: the typed text is saved as typed, with the decision on the unchanged paragraph.
    failing = false;
    controller.editText(typed);
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    expect(controller.getState().error).toBeNull(); // the "Nothing can be saved" banner goes (m7)
    expect(await controller.save()).toBe(true);
    expect(decode(saves[0].bytes)).toBe("Hi there. I can't go.\n\nYou cannot stay.");
  });

  it('a check that works again takes down the "Nothing can be saved" banner (final re-review m7)', async () => {
    let failing = false;
    const flaky: RulesLinter = {
      ...shared,
      variant: shared.variant,
      lintParagraphs: (p, l) => (failing ? Promise.reject(new Error('checker stopped')) : shared.lintParagraphs(p, l)),
    };
    const { controller } = makeController({ createLinter: async () => flaky });
    await controller.openText(CANT);
    failing = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    controller.editText(`Hi there. ${CANT}`);
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    expect(english(controller.getState().error)).toMatch(/Nothing can be saved until the text is checked/);
    failing = false;
    controller.editText(`Hi there. ${CANT} More.`);
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    expect(controller.getState().error).toBeNull();
  });

  it('Close document while a re-check runs: its result is dropped, not shown after the close', async () => {
    const { controller } = makeController();
    await controller.openText(CANT);
    let release!: () => void;
    lintGate = new Promise((r) => (release = r));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    controller.editText(`${CANT} More.`);
    await vi.advanceTimersByTimeAsync(300);
    await controller.close();
    release();
    await controller.settled();
    expect(controller.getState()).toMatchObject({ phase: 'empty', document: null, session: null });
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

  // #39: the engine reports an applied AI rewrite it could not carry (tests/engine/llm/rewriteLifecycle.test.ts); the
  // controller turns that into a lasting notice, once per re-check that dropped one.
  describe('a dropped AI rewrite says so (#39)', () => {
    const DROPPED = 'An AI rewrite you applied was taken back: a settings change moved an edit across its sentence. Ask for a new rewrite if you still want one.';

    it('shows the notice for the re-check that dropped one, and not for the next', async () => {
      const { controller } = makeController();
      await controller.openText("I can't go.");
      const drop = vi.spyOn(CheckSession.prototype, 'droppedAppliedRewrites').mockReturnValueOnce(['llm:0:0-11']);
      controller.setPreset('blog');
      await controller.settled();
      expect(english(controller.getState().notice)).toBe(DROPPED);
      controller.dismissNotice();
      controller.setPreset('academic');
      await controller.settled();
      expect(controller.getState().notice).toBeNull();
      drop.mockRestore();
    });

    it('a re-check that dropped nothing shows no notice', async () => {
      const { controller } = makeController();
      await controller.openText("I can't go.");
      controller.setPreset('blog');
      await controller.settled();
      expect(controller.getState().notice).toBeNull();
    });
  });

  // #34: an Apply pressed in the typing pause lands on the old text; the re-check must say so when the paragraph changed.
  describe('an Apply lost to typing says so (#34)', () => {
    const LOST = 'That fix wasn’t applied: the paragraph changed while you were typing. Check the updated suggestion.';

    it('a card accepted during the pause, in a paragraph then changed: the notice shows once', async () => {
      const { controller } = makeController();
      await controller.openText("I can't go.");
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      controller.editText("I can't go home.");
      controller.accept(controller.getState().session!.decisions().top[0].id);
      await vi.advanceTimersByTimeAsync(300);
      await controller.settled();
      expect(english(controller.getState().notice)).toBe(LOST);
      expect(controller.getState().session!.outputText(0)).toBe("I can't go home.");
      // A later re-check does not repeat it.
      controller.dismissNotice();
      controller.editText("I can't go home now.");
      await vi.advanceTimersByTimeAsync(300);
      await controller.settled();
      expect(controller.getState().notice).toBeNull();
    });

    it('a batch applied during the pause: the changed paragraph is reported, the unchanged one keeps its fix', async () => {
      const { controller } = makeController();
      await controller.openText(CANT);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      controller.editText("I can't go.\n\nYou can't stay here.");
      const batch = controller.getState().session!.decisions().top.find((d) => d.kind === 'batch')!;
      controller.applyBatch(batch.id, batch.candidateIds);
      await vi.advanceTimersByTimeAsync(300);
      await controller.settled();
      const s = controller.getState().session!;
      expect(english(controller.getState().notice)).toBe(LOST);
      expect(s.outputText(0)).toBe('I cannot go.');
      expect(s.outputText(1)).toBe("You can't stay here.");
      controller.dismissNotice();
      controller.editText("I can't go.\n\nYou can't stay here, please.");
      await vi.advanceTimersByTimeAsync(300);
      await controller.settled();
      expect(controller.getState().notice).toBeNull();
    });

    it('a click in a paragraph typed while an earlier check runs is still reported by the next check', async () => {
      // No browser pauses: with them, check N+1 would replace N before N finishes.
      const { controller } = makeController({ yieldToBrowser: async () => {} });
      await controller.openText("I can't go.\n\nI recieve it.");
      let release!: () => void;
      lintGate = new Promise((r) => (release = r));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      controller.editText("I can't go.\n\nI recieve it now."); // check N starts and waits on the gate
      await vi.advanceTimersByTimeAsync(300);
      controller.editText("I can't go home.\n\nI recieve it now."); // check N+1 is queued
      const card = controller.getState().session!.decisions().top.find((d) => d.candidateIds.every((id) => id.startsWith('0:')))!;
      controller.accept(card.id);
      release();
      await vi.advanceTimersByTimeAsync(300);
      await controller.settled();
      expect(english(controller.getState().notice)).toBe(LOST);
    });

    it('typing over a paragraph with an earlier fix, with no click during the pause, shows no notice', async () => {
      const { controller } = makeController();
      await controller.openText(CANT);
      const batch = controller.getState().session!.decisions().top.find((d) => d.kind === 'batch')!;
      controller.accept(batch.id);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      controller.editText("I can't go.\n\nYou can't stay here.");
      await vi.advanceTimersByTimeAsync(300);
      await controller.settled();
      expect(controller.getState().notice).toBeNull();
    });
  });

  // Final F14 review I-3 (owner decision, Task F15): copies paired in order put a decision on the other copy.
  describe('a paragraph whose text is found more than once, before or after the typing, keeps no decision', () => {
    const COPY = 'I recieve it.';
    const output = (c: SessionController) => c.getState().session!.paragraphs().map((p) => c.getState().session!.outputText(p.id));
    const recieveCard = (c: SessionController) => [...c.getState().session!.decisions().top, ...c.getState().session!.decisions().more].find((d) => d.label.includes('recieve'))!;
    async function retype(c: SessionController, text: string) {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      c.editText(text);
      await vi.advanceTimersByTimeAsync(300);
      await c.settled();
    }

    it('copy 1 fixed, copy 2 rejected ("sic"), copy 1 deleted: the rejected copy stays as typed and comes back for review', async () => {
      const { controller } = makeController({ settings: { preset: 'blog' } });
      await controller.openText(`${COPY}\n\nNote.\n\n${COPY}`);
      const [first, second] = recieveCard(controller).candidateIds;
      controller.applyBatch(recieveCard(controller).id, [first]);
      controller.reject(second);
      expect(output(controller)).toEqual(['I receive it.', 'Note.', COPY]);

      await retype(controller, `Note.\n\n${COPY}`);
      expect(output(controller)).toEqual(['Note.', COPY]);
      expect(controller.getState().session!.outcomes().filter((o) => o.candidate.original === 'recieve').map((o) => o.status)).toEqual(['pending']);
    });

    it('a copy pasted above a fixed paragraph: neither copy gets the fix, and a unique paragraph keeps its decision', async () => {
      const { controller } = makeController({ settings: { preset: 'blog' } });
      await controller.openText(`${COPY}\n\nYou recieve "sic" calls.`);
      const [first, second] = recieveCard(controller).candidateIds;
      controller.applyBatch(recieveCard(controller).id, [first]);
      controller.reject(second);

      await retype(controller, `${COPY}\n\n${COPY}\n\nYou recieve "sic" calls.`);
      expect(output(controller)).toEqual([COPY, COPY, 'You recieve "sic" calls.']);
      const status = controller.getState().session!.outcomes().filter((o) => o.candidate.original === 'recieve').map((o) => o.status);
      expect(status).toEqual(['pending', 'pending', 'rejected']);
    });

    // Final F15 review M-13: the undone change came back applied, with no click and no card.
    describe('a change made without a click and undone on a copy is never made again: both copies show it as a card', () => {
      const TOTAL = 'We bought  five items.';
      const collapses = (c: SessionController) =>
        c.getState().session!.outcomes().filter((o) => o.candidate.original === '  ').map((o) => [o.status, o.auto]);
      const offered = (c: SessionController) => {
        const { top, more } = c.getState().session!.decisions();
        return [...top, ...more].flatMap((d) => d.candidateIds).filter((id) => id.endsWith(':9:11:Formatting'));
      };
      async function undoFirstCollapse(text: string) {
        const { controller } = makeController({ settings: { preset: 'blog' } });
        await controller.openText(text);
        controller.undo(controller.getState().session!.outcomes().find((o) => o.candidate.original === '  ' && o.auto)!.candidate.id);
        return controller;
      }

      it('typing in another paragraph, twice', async () => {
        const controller = await undoFirstCollapse(`${TOTAL}\n\n${TOTAL}\n\nMore.`);
        expect(output(controller)).toEqual([TOTAL, 'We bought five items.', 'More.']);

        await retype(controller, `${TOTAL}\n\n${TOTAL}\n\nMore text.`);
        expect(output(controller)).toEqual([TOTAL, TOTAL, 'More text.']);
        expect(collapses(controller)).toEqual([
          ['pending', false],
          ['pending', false],
        ]);
        expect(offered(controller)).toEqual(['0:9:11:Formatting', '1:9:11:Formatting']);

        await retype(controller, `${TOTAL}\n\n${TOTAL}\n\nMore text here.`);
        expect(output(controller)).toEqual([TOTAL, TOTAL, 'More text here.']);
        expect(offered(controller)).toEqual(['0:9:11:Formatting', '1:9:11:Formatting']);
      });

      it('a copy pasted of the paragraph where it was undone', async () => {
        const controller = await undoFirstCollapse(`${TOTAL}\n\nMore.`);
        await retype(controller, `${TOTAL}\n\n${TOTAL}\n\nMore.`);
        expect(output(controller)).toEqual([TOTAL, TOTAL, 'More.']);
        expect(offered(controller)).toEqual(['0:9:11:Formatting', '1:9:11:Formatting']);
      });
    });
  });

  // Final F15 review M-14: with the same paragraph list, which copy is which is certain.
  describe('a re-check that sees the same paragraph list keeps every decision, copies included', () => {
    const COPIES = 'I recieve it.\n\nI recieve it.\n\nYou recieve "sic" calls.';
    const output = (c: SessionController) => c.getState().session!.paragraphs().map((p) => c.getState().session!.outputText(p.id));
    const recieveStatus = (c: SessionController) =>
      c.getState().session!.outcomes().filter((o) => o.candidate.original === 'recieve').map((o) => o.status);
    /** Copy 1 fixed, copy 2 rejected ("sic"), the third paragraph rejected too. */
    function decide(c: SessionController) {
      const { top, more } = c.getState().session!.decisions();
      const card = [...top, ...more].find((d) => d.label.includes('recieve'))!;
      const [first, second, third] = card.candidateIds;
      c.applyBatch(card.id, [first]);
      c.reject(second);
      c.reject(third);
      expect(output(c)).toEqual(['I receive it.', 'I recieve it.', 'You recieve "sic" calls.']);
    }

    it.each([
      ['a goal change', (c: SessionController) => c.setPreset('academic')],
      ['"this rule in this document"', (c: SessionController) => c.ignoreRule('Contraction', 'document')],
    ])('%s', async (_, recheck) => {
      const { controller } = makeController({ settings: { preset: 'blog' } });
      await controller.openText(COPIES);
      decide(controller);
      const checks = lintCalls;
      recheck(controller);
      await controller.settled();
      expect(lintCalls).toBe(checks + 1);
      expect(output(controller)).toEqual(['I receive it.', 'I recieve it.', 'You recieve "sic" calls.']);
      expect(recieveStatus(controller)).toEqual(['applied', 'rejected', 'rejected']);
    });

    it('a change made without a click and undone on one copy stays undone there, and stays made on the other', async () => {
      const { controller } = makeController({ settings: { preset: 'blog' } });
      await controller.openText('We bought  five items.\n\nWe bought  five items.\n\nMore.');
      const collapse = (c: SessionController) => c.getState().session!.outcomes().filter((o) => o.candidate.original === '  ');
      controller.undo(collapse(controller)[0].candidate.id);
      controller.setPreset('academic');
      await controller.settled();
      expect(output(controller)).toEqual(['We bought  five items.', 'We bought five items.', 'More.']);
      expect(collapse(controller).map((o) => [o.status, o.auto])).toEqual([
        ['rejected', false],
        ['applied', true],
      ]);
    });

    it('a .docx re-checked after a goal change', async () => {
      const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text.replace(/"/g, '&quot;')}</w:t></w:r></w:p>`;
      const bytes = await buildDocx(COPIES.split('\n\n').map(paragraph).join(''));
      const { controller } = makeController({ settings: { preset: 'blog' } });
      await controller.openFile({ name: 'table.docx', path: '/docs/table.docx', bytes });
      decide(controller);
      controller.setPreset('academic');
      await controller.settled();
      expect(output(controller)).toEqual(['I receive it.', 'I recieve it.', 'You recieve "sic" calls.']);
      expect(recieveStatus(controller)).toEqual(['applied', 'rejected', 'rejected']);
    });
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

  it('typing or pasting past the word limit is refused at once, unchecked, and nothing is saved until it is shorter (Task U3 fix 1)', async () => {
    const { files, saves } = fakeFiles();
    const { controller } = makeController({ files });
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: encode(CANT) });
    const lintsBefore = lintCalls;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t0 = performance.now();
    controller.editText(`${CANT}\n\n${'word '.repeat(60_000)}`);
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(lintCalls).toBe(lintsBefore);
    expect(english(controller.getState().error)).toMatch(/^note\.txt is too long to check in one go \(60,006 words; the limit is 50,000 words\)\./);
    // Saving now would write the file without the typed text: it is refused, with the same message.
    controller.dismissError();
    expect(await controller.save()).toBe(false);
    expect(saves).toEqual([]);
    expect(english(controller.getState().error)).toMatch(/^note\.txt is too long to check in one go/);
    // Back under the limit: checked again, and saved as typed.
    controller.editText(`${CANT} More.`);
    await vi.advanceTimersByTimeAsync(300);
    await controller.settled();
    expect(await controller.save()).toBe(true);
    expect(decode(saves[0].bytes)).toBe(`${CANT} More.`);
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

  it('the sample paragraph shows each kind of card: simple fixes, a review, a batch, names and terms', async () => {
    const { controller } = makeController({ settings: { preset: 'business' } });
    await controller.openSample();
    const { document, session } = controller.getState();
    expect(document!.name).toBe('Sample.txt');
    expect(document!.editable).toBe(true);
    // "teh" waits on the simple-fixes card (Task F4): nothing that changes a word is applied without a click.
    expect(session!.decisions().top.map((d) => d.id)).toContain(SIMPLE_FIXES_ID);
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

// Task F20 item 9b (owner): "Vantix" was stored while reviewing `vantix`, and a reopen flagged `vantix` in 26 places.
describe('SessionController: a word added to the dictionary holds after a reopen', () => {
  it('stored as written (lowercase), saved, and no case of it is flagged when the document is opened again', async () => {
    // The card's first place is the capitalised sentence start. "Vantix" is no slip of a word, so the Names card would
    // take it; with that card off it joins the word's card.
    const text = 'Vantix is our app.\n\nWe use vantix daily, and vantix often.\n\nAsk vantix support.';
    const { controller, saved } = makeController({ settings: { preset: 'blog', fallbackVariant: 'Indian', modules: { ...DEFAULT_MODULES, namesCard: false } } });
    await controller.openText(text);
    const session = controller.getState().session!;
    const flag = session.candidates().find((c) => c.original === 'vantix')!;
    const { top, more } = session.decisions();
    const card = [...top, ...more].find((d) => d.candidateIds.includes(flag.id))!;
    expect(card.candidateIds[0]).toBe('0:0:6:Spelling');
    await controller.addToDictionary(card.id);
    expect(saved.at(-1)!.dictionary).toContain('vantix');
    expect(saved.at(-1)!.dictionary).not.toContain('Vantix');

    await controller.openText(`${text}\n\nVANTIX rocks.`);
    const reopened = controller.getState().session!;
    expect(reopened.candidates().filter((c) => /^vantix$/i.test(c.original) && reopened.tier(c.id) !== 'hidden').map((c) => c.original)).toEqual([]);
  });

  // Task F21 item G (owner): the saved dictionary held "Vantix" and "vantix", "VPC" and "vpc".
  it('a lowercase word replaces its other-case entries in the saved dictionary', async () => {
    const { controller, saved } = makeController({ settings: { preset: 'blog', fallbackVariant: 'Indian', dictionary: ['VANTIX', 'VPC'] } });
    await controller.openText('We use vantix daily, and vantix often.');
    const session = controller.getState().session!;
    const flag = session.candidates().find((c) => c.original === 'vantix')!;
    const { top, more } = session.decisions();
    await controller.addToDictionary([...top, ...more].find((d) => d.candidateIds.includes(flag.id))!.id);
    expect(saved.at(-1)!.dictionary).toEqual(['VPC', 'vantix']);
  });
});

// Task F24 (F23 adversarial review M-37): the undo toast lived through a dictionary Add, and its Undo brought the
// word's card back or failed with "unknown batch".
describe('SessionController: a dictionary change takes the undo toast away', () => {
  // The tests share one linter, which keeps added words: each test adds a word of its own.
  it.each([
    ['Reject, then Add', 'recieve', (c: SessionController, id: string) => c.reject(id)],
    ['Apply, then Add', 'occured', (c: SessionController, id: string, ids: string[]) => c.applyBatch(id, ids)],
  ])('%s: no toast after the Add, so no Undo can bring the card back', async (_name, word, bigAction) => {
    const { controller } = makeController({ settings: { preset: 'business', fallbackVariant: 'Indian' } });
    await controller.openText(`It ${word} today. It ${word} later. It ${word} never.`);
    const card = [...controller.getState().session!.decisions().top].find((d) => d.candidateIds.length === 3)!;
    bigAction(controller, card.id, card.candidateIds);
    expect(controller.getState().undoOffer).not.toBeNull();

    await controller.addDictionaryWord(word);
    expect(controller.getState().undoOffer).toBeNull();
    expect(controller.undoBigAction()).toBeNull();
    expect(controller.getState().error).toBeNull();
    const { top, more } = controller.getState().session!.decisions();
    expect([...top, ...more].filter((d) => d.label.includes(word))).toEqual([]);
  });

  it("another card's Add to dictionary takes it away too", async () => {
    const { controller } = makeController({ settings: { preset: 'business', fallbackVariant: 'Indian' } });
    await controller.openText('We will seperate it today. You seperate it later. I beleive it.');
    const session = controller.getState().session!;
    const cardOf = (word: string) => {
      const flag = session.candidates().find((c) => c.original === word)!;
      const { top, more } = session.decisions();
      return [...top, ...more].find((d) => d.candidateIds.includes(flag.id))!;
    };
    const believe = cardOf('beleive');
    controller.reject(cardOf('seperate').id);
    expect(controller.getState().undoOffer).not.toBeNull();
    await controller.addToDictionary(believe.id);
    expect(controller.getState().undoOffer).toBeNull();
  });
});

// Task F20 item 6 (owner: "v1.0: yield"): a long check let no click, scroll or keypress through until it ended.
describe('SessionController: a long check yields to the browser between chunks', () => {
  /** About 60 paragraphs, several chunks. */
  const LONG = Array.from({ length: 60 }, (_, i) => `I think teh plan works in part ${i}. We went to the the market.`).join('\n\n');

  it('yields at least once on a large document', async () => {
    const yieldToBrowser = vi.fn(async () => {});
    const { controller } = makeController({ yieldToBrowser });
    await controller.openText(LONG);
    expect(controller.getState().phase).toBe('ready');
    expect(yieldToBrowser.mock.calls.length).toBeGreaterThan(1);
  });

  it('a goal change during a running check shows only the newer check\'s result', async () => {
    let changed = false;
    const shown: unknown[] = [];
    const { controller } = makeController({
      yieldToBrowser: async () => {
        await new Promise((r) => setTimeout(r, 0));
        // The user changes the goal while the first check is still reading the text.
        if (!changed) {
          changed = true;
          controller.setPreset('blog');
        }
      },
    });
    controller.subscribe(() => {
      const { session } = controller.getState();
      if (session && !shown.includes(session)) shown.push(session);
    });
    await controller.openText(LONG);
    await controller.settled();
    expect(changed).toBe(true);
    expect(controller.getState()).toMatchObject({ phase: 'ready', error: null, checking: false });
    expect(controller.getState().settings.preset).toBe('blog');
    // One session only: the first check stopped at its next pause, so its result never showed.
    expect(shown).toHaveLength(1);
    const lintedAlone = makeController({ settings: { preset: 'blog' } }).controller;
    await lintedAlone.openText(LONG);
    expect(controller.getState().session!.decisionCount()).toBe(lintedAlone.getState().session!.decisionCount());
  });

  it('a decision made while a re-check runs is kept by that re-check', async () => {
    let hold: (() => void) | null = null;
    let holding = false;
    const { controller } = makeController({
      yieldToBrowser: () => (holding ? new Promise<void>((r) => (hold = r)) : Promise.resolve()),
    });
    await controller.openText(LONG);
    holding = true;
    controller.setPreset('blog'); // the re-check stops at its first pause
    await vi.waitFor(() => expect(hold).not.toBeNull());
    const card = controller.getState().session!.decisions().top[0];
    controller.reject(card.id);
    holding = false;
    hold!();
    await controller.settled();
    const after = controller.getState().session!;
    const rejected = after.outcomes().filter((o) => o.status === 'rejected');
    expect(rejected.map((o) => o.candidate.id)).toEqual(expect.arrayContaining(card.candidateIds));
  });
});
