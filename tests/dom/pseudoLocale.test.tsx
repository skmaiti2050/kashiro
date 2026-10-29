// Pseudo-locale (Task L1): the main screens in en-XA have no raw English left, and their key containers
// can take ~35% longer text without overflowing. jsdom has no layout, so the overflow check is at
// component level, on the app's real CSS: key rows must wrap, no UI text may be kept on one line, and a
// fixed-width grid column must fit the longest word placed in it.
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { LANGUAGE_NAMES } from '@/ui/i18n/locale';
import { createTranslator } from '@/ui/i18n/translator';
import type { MessageKey } from '@/ui/i18n/catalogues';
import { englishOnly, explanation } from '@/ui/state/plainMessages';
import type { SessionController } from '@/ui/state/sessionController';
import { memorySessionFiles } from '../fixtures/memorySessionFiles';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, installSpeech, LOCAL_VOICE, openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const pseudo = createTranslator('en-XA', []);
const name = (key: MessageKey) => pseudo.t(key);

/** A plain-ASCII word ("Save"): pseudo-localised text has accented letters, so this text skipped the catalogue. */
const RAW_WORD = /[A-Za-z]{2,}/g;
/** A file name ("Sample.checked.txt"): the user's data, not UI text. */
const FILE_NAME = /[\w-]+(?:\.[\w-]+)*\.(?:docx|txt|md|bak)\b/g;
/** Quoted text (“could of”): stripped only when it is the user's words, so a quoted UI label is still checked. */
const QUOTED = /“([^”]*)”/g;

/** Rows of controls and labels that must wrap rather than overflow when the text grows. */
const KEY_ROWS = ['.toolbar', '.statusbar', '.empty-actions', '.actions', '.read-aloud', '.changelog-bar', '.dictionary li', '.dialog-header'];
/** The KEY_ROWS some screen rendered: each must, or its check proved nothing. */
const rowsSeen = new Set<string>();
/** A generous average glyph width for 14px text (0.6em): pseudo text is wider than plain English. */
const CHAR_PX = 8.4;

beforeAll(async () => {
  await warmLinter();
  const style = document.createElement('style');
  style.textContent = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
  document.head.append(style);
});

/**
 * Text to check: in the UI language (en-XA), or marked English (lang="en": checked unless it is the
 * document's own words, see isDocumentText). Endonyms (lang="hi", "bn"), key caps, the editor and the bug report
 * (English by design: it goes to the issue tracker) are skipped.
 */
const isUiText = (el: Element | null): el is Element => {
  const lang = el?.closest('[lang]')?.getAttribute('lang');
  return el !== null && (lang === 'en-XA' || lang === 'en') && !el.closest('kbd, .cm-content, .bug-report-text');
};

/** "button.primary": where a finding is, for the failure message. */
const elementName = (el: Element) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''}`;

/** The UI-language text on the page: text nodes, and the attributes screen readers and tooltips read. */
function uiTexts(): { text: string; el: Element; where: string }[] {
  const found: { text: string; el: Element; where: string }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (isUiText(el) && node.textContent!.trim()) found.push({ text: node.textContent!, el, where: elementName(el) });
  }
  for (const el of document.body.querySelectorAll('[aria-label], [title], [placeholder], [aria-placeholder]')) {
    if (!isUiText(el)) continue;
    for (const attribute of ['aria-label', 'title', 'placeholder', 'aria-placeholder']) {
      const value = el.getAttribute(attribute);
      if (value) found.push({ text: value, el, where: `${elementName(el)}@${attribute}` });
    }
  }
  return found;
}

/** Intl's own words between list items (" or ", ", or "): CLDR has no en-XA, so they stay English there (hi: "या"). */
const listWords = (['conjunction', 'disjunction'] as const).flatMap((type) =>
  [2, 3].map((n) => pseudo.list(Array(n).fill('\u0000'), type).split('\u0000').filter(Boolean)).flat(),
);

/**
 * Text the app shows as it is, in any language: Harper's own messages (English by design, flagged on the
 * card), the user's dictionary words, voice names, endonyms, and Intl's list words.
 */
function dataStrings(controller: SessionController): string[] {
  const harper = (controller.getState().session?.candidates() ?? []).filter((c) => englishOnly(explanation(c))).map((c) => c.message);
  const dictionary = controller.getState().settings.dictionary;
  return [...harper, ...dictionary, LOCAL_VOICE.name, ...Object.values(LANGUAGE_NAMES), ...listWords].sort((a, b) => b.length - a.length);
}

/** The user's own words, as the app may show them: the paragraphs, the suggested replacements, the dictionary. */
function documentTexts(controller: SessionController): string[] {
  const { session, settings } = controller.getState();
  const fromDocument = session ? [...session.paragraphs().map((p) => p.text), ...session.candidates().flatMap((c) => c.replacements)] : [];
  return [...fromDocument, ...settings.dictionary].map((s) => s.toLowerCase());
}

/** True when `text` is the document's words (an excerpt may end in " …"; the Indian-language card lowercases). */
function isDocumentText(text: string, documents: string[]): boolean {
  const words = text.trim().replace(/ …$/, '').toLowerCase();
  return words !== '' && documents.some((d) => d.includes(words));
}

/** Every ASCII word left in the UI's text once the user's data is taken out. */
function rawEnglish(controller: SessionController): string[] {
  const data = dataStrings(controller);
  const documents = documentTexts(controller);
  return uiTexts().flatMap(({ text, el, where }) => {
    if (el.closest('[lang]')?.getAttribute('lang') === 'en' && (isDocumentText(text, documents) || data.includes(text.trim()))) return [];
    let rest = text.replace(FILE_NAME, '').replace(QUOTED, (quoted, inner: string) => (isDocumentText(inner, documents) ? '' : quoted));
    for (const value of data) rest = rest.split(value).join('');
    return (rest.match(RAW_WORD) ?? []).map((word) => `${where}: “${word}” in “${text.trim()}”`);
  });
}

/** The column sizes of a grid ("minmax(0, 1fr) 92px" → ["minmax(0, 1fr)", "92px"]). */
const gridTracks = (template: string) => template.match(/[\w.-]+\([^)]*\)|\S+/g) ?? [];

/** Places where longer text would overflow its container instead of wrapping. */
function overflowRisks(): string[] {
  const risks: string[] = [];
  for (const selector of KEY_ROWS) {
    for (const row of document.querySelectorAll(selector)) {
      rowsSeen.add(selector);
      const style = getComputedStyle(row);
      if (style.display.endsWith('flex') && style.flexWrap !== 'wrap') risks.push(`${elementName(row)}: a flex row that does not wrap`);
    }
  }
  for (const { el, where } of uiTexts()) {
    const unbreakable = ancestors(el).find((a) => getComputedStyle(a).whiteSpace === 'nowrap' && !a.matches('.visually-hidden'));
    if (unbreakable) risks.push(`${where}: kept on one line by ${elementName(unbreakable)}`);
  }
  for (const grid of document.querySelectorAll('*')) {
    const style = getComputedStyle(grid);
    if (style.display !== 'grid' || !style.gridTemplateColumns) continue;
    const tracks = gridTracks(style.gridTemplateColumns);
    // Bare text in a grid lands in its first track ("No changes yet." in the change log's 48px column, Task U3 item 7).
    const bare = [...grid.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()).map((n) => n.textContent!.trim());
    const firstFixed = /^(\d+)px$/.exec(tracks[0] ?? '');
    if (firstFixed && bare.length && isUiText(grid)) {
      const longest = Math.max(...bare.join(' ').split(/\s+/).map((word) => [...word].length));
      if (longest * CHAR_PX > Number(firstFixed[1])) risks.push(`${elementName(grid)}: bare text in its ${firstFixed[1]}px first column: “${bare.join(' ')}”`);
    }
    [...grid.children].forEach((child, i) => {
      const fixed = /^(\d+)px$/.exec(tracks[i % tracks.length] ?? '');
      if (!fixed || !isUiText(child)) return;
      const longest = Math.max(0, ...(child.textContent ?? '').replace(/~/g, '').split(/\s+/).map((word) => [...word].length));
      if (longest * CHAR_PX > Number(fixed[1])) risks.push(`${elementName(grid)} column ${(i % tracks.length) + 1} (${fixed[1]}px): “${child.textContent}”`);
    });
  }
  return risks;
}

function ancestors(el: Element): Element[] {
  const chain: Element[] = [];
  for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) chain.push(a);
  return chain;
}

async function expectTranslatedAndFitting(controller: SessionController): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  expect(rawEnglish(controller)).toEqual([]);
  expect(overflowRisks()).toEqual([]);
}

describe('pseudo-locale (en-XA)', () => {
  it('start screen and Google Docs help', async () => {
    const { controller } = makeController({ uiLanguage: 'en-XA' });
    renderShell(controller);
    await expectTranslatedAndFitting(controller);
    chooseFromMore(name('toolbar.googleDocs'), name('toolbar.more'));
    await expectTranslatedAndFitting(controller);
  });

  it('saved reviews: the Recent reviews list (a file and pasted text) and the resume prompt for a changed file', async () => {
    const disk = memorySessionFiles();
    const file = { name: 'note.txt', path: '/docs/note.txt', bytes: new TextEncoder().encode('She recieved the letter.\n\nWe was late.') };
    const first = makeController({ keepPastedText: true }, undefined, disk.files).controller;
    await first.openFile(file);
    first.reject(first.getState().session!.decisions().top[0].id);
    await first.openText('Pasted: she recieved it.');
    first.reject(first.getState().session!.decisions().top[0].id);
    await first.reviews.flush();

    const { controller } = makeController({ uiLanguage: 'en-XA' }, undefined, disk.files);
    renderShell(controller);
    await act(() => controller.reviews.startUp());
    expect(screen.getByRole('region', { name: name('recent.title') }).querySelectorAll('button')).toHaveLength(2);
    await expectTranslatedAndFitting(controller);
    await openAndWait(controller, () => controller.openFile({ ...file, bytes: new TextEncoder().encode('She recieved the letter.') }));
    await screen.findByRole('alertdialog', { name: name('resume.changedTitle') });
    await expectTranslatedAndFitting(controller);
  });

  it('review: toolbar, document, cards, more list, read aloud and status bar', async () => {
    const speech = installSpeech([LOCAL_VOICE]);
    try {
      const { controller } = makeController({ uiLanguage: 'en-XA' });
      renderShell(controller);
      await openAndWait(controller, () => controller.openSample());
      await screen.findByRole('group', { name: name('read.group') });
      await expectTranslatedAndFitting(controller);
      for (let i = 0; i < 3; i++) {
        fireEvent.keyDown(screen.getByRole('complementary', { name: name('panel.label') }), { key: 'j' });
        await expectTranslatedAndFitting(controller);
      }
    } finally {
      speech.remove();
    }
  });

  it('the change log, open with no changes yet', async () => {
    const { controller } = makeController({ uiLanguage: 'en-XA' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('Nothing to fix here.'));
    fireEvent.click(screen.getByRole('button', { name: `▸ ${pseudo.t('log.toggle', { count: 0 })}` }));
    expect(screen.getByText(name('log.empty'))).toBeTruthy();
    await expectTranslatedAndFitting(controller);
  });

  it('Settings, keyboard shortcuts and unsaved changes', async () => {
    const speech = installSpeech([LOCAL_VOICE]);
    try {
      // A dictionary word, so Settings shows its rows.
      const { controller } = makeController({ uiLanguage: 'en-XA', dictionary: ['sarpanch'] });
      renderShell(controller);
      await openAndWait(controller, () => controller.openSample());
      chooseFromMore(name('toolbar.settings'), name('toolbar.more'));
      for (const tab of ['settings.tabReading', 'settings.tabChecking', 'settings.tabSaving', 'settings.tabModules', 'settings.tabLanguage'] as const) {
        fireEvent.click(screen.getByRole('tab', { name: name(tab) }));
        await expectTranslatedAndFitting(controller);
      }
      fireEvent.click(screen.getByRole('button', { name: name('dialog.close') }));
      chooseFromMore(name('toolbar.dictionary'), name('toolbar.more'));
      fireEvent.click(screen.getByRole('button', { name: name('dictionary.merge') }));
      await expectTranslatedAndFitting(controller);
      fireEvent.change(screen.getByRole('searchbox', { name: name('dictionary.search') }), { target: { value: 'zzz' } });
      await expectTranslatedAndFitting(controller);
      fireEvent.click(screen.getByRole('button', { name: name('dialog.close') }));
      chooseFromMore(name('toolbar.reportBug'), name('toolbar.more'));
      await expectTranslatedAndFitting(controller);
      fireEvent.click(screen.getByRole('button', { name: name('dialog.close') }));
      chooseFromMore(name('toolbar.shortcuts'), name('toolbar.more'));
      await expectTranslatedAndFitting(controller);
      fireEvent.click(screen.getByRole('button', { name: name('dialog.close') }));
      fireEvent.keyDown(screen.getByRole('complementary', { name: name('panel.label') }), { key: 'Backspace' });
      fireEvent.keyDown(document.body, { key: 'o', ctrlKey: true });
      expect(screen.getByRole('alertdialog', { name: name('unsaved.title') })).toBeTruthy();
      await expectTranslatedAndFitting(controller);
    } finally {
      speech.remove();
    }
  });

  it('change log, save menu and dismiss menu', async () => {
    const { controller } = makeController({ uiLanguage: 'en-XA' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    // "▸ [Çĥàñĝé ļöĝ (3 àþþļîéð) ~~~]": the toggle names the log's label.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(escape(name('log.label').split(' ~')[0])) }));
    act(() => {
      document.querySelector<HTMLDetailsElement>('.save-menu')!.open = true;
    });
    await expectTranslatedAndFitting(controller);
    const panel = screen.getByRole('complementary', { name: name('panel.label') });
    for (let i = 0; i < 10 && !screen.queryByRole('button', { name: name('dismiss.button') }); i++) fireEvent.keyDown(panel, { key: 'j' });
    fireEvent.click(screen.getByRole('button', { name: name('dismiss.button') }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await expectTranslatedAndFitting(controller);
  });

  it('F23: the command palette, the quick fix, the folded panel and the welcome tour', async () => {
    const { controller } = makeController({ uiLanguage: 'en-XA', preset: 'blog' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('Each farmer should recieve water.'));
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    await expectTranslatedAndFitting(controller);
    fireEvent.keyDown(screen.getByRole('combobox', { name: name('palette.search') }), { key: 'Escape' });
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('recieve') + 1 } });
    });
    fireEvent.keyDown(view.contentDOM, { key: 'Enter', altKey: true });
    expect(document.querySelector('.quick-fix')).not.toBeNull();
    await expectTranslatedAndFitting(controller);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: name('split.hide') }));
    await expectTranslatedAndFitting(controller);
    chooseFromMore(name('toolbar.tour'), name('toolbar.more'));
    await expectTranslatedAndFitting(controller);
  });

  it('every key row was rendered by some screen above', () => {
    expect([...rowsSeen].sort()).toEqual([...KEY_ROWS].sort());
  });

  it('the check catches raw English (also marked lang="en", or quoted) and a fixed column too narrow for its word', () => {
    document.body.innerHTML = `<div lang="en-XA"><button>Save</button><span lang="en">Delete</span><p>[Àļļ “Formatting” ~]</p><div style="display:grid;grid-template-columns:40px 1fr"><span>[Ŧĥöŕöûĝĥ ~~]</span><span>x</span></div></div>`;
    const controller = makeController().controller;
    expect(rawEnglish(controller)).toEqual(['button: “Save” in “Save”', 'span: “Delete” in “Delete”', 'p: “Formatting” in “[Àļļ “Formatting” ~]”']);
    expect(overflowRisks()).toEqual(['div column 1 (40px): “[Ŧĥöŕöûĝĥ ~~]”']);
    document.body.innerHTML = '';
  });
});

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
