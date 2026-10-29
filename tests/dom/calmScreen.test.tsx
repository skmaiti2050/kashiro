/**
 * A calmer screen (Task U3 group 5): the toolbar keeps Open, Paste, Goal, the English variant and Save; the rest
 * is in one keyboard-accessible ⋯ menu (with Look up word and Close document); the done state is one calm line.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { DEFAULT_MODULES } from '@/engine/modules';
import { fakeDictionary } from './fakeDictionary';
import { makeController, noFiles, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell, reviewPanel } from './shell';
import { english } from '../ui/english';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { SessionController } from '@/ui/state/sessionController';
import { defaultSettings } from '@/ui/state/settings';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const toolbar = () => screen.getByRole('toolbar');

describe('toolbar', () => {
  it('shows Open, Paste, Goal, the English variant and Save; the rest is behind ⋯', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const buttons = within(toolbar()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent!.trim());
    expect(buttons).toEqual(['Open', 'Paste', 'More', 'Save']);
    expect(within(toolbar()).getByRole('combobox', { name: 'Goal' })).toBeTruthy();
    expect(within(toolbar()).getByRole('combobox', { name: /English/ })).toBeTruthy();
  });

  it('the ⋯ menu: arrows move, Escape closes it and focus returns to ⋯', async () => {
    const { controller } = makeController({ modules: { ...DEFAULT_MODULES, wordLookup: true } }, undefined, undefined, () => Promise.resolve(fakeDictionary));
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More' });
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent!.replace(/Ctrl\+\S+|F1/, '').trim());
    expect(items).toEqual(['Look up word', 'Close document', 'Google Docs', 'Keyboard shortcuts', 'Settings', 'Dictionary…', 'About']);
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement!.textContent).toMatch(/^About/);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('Settings, Keyboard shortcuts and About open from the menu', async () => {
    const { controller } = makeController();
    renderShell(controller);
    chooseFromMore('Settings');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    chooseFromMore('Keyboard shortcuts');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('Look up word acts on the word at the cursor', async () => {
    const { controller } = makeController({ modules: { ...DEFAULT_MODULES, wordLookup: true } }, undefined, undefined, () => Promise.resolve(fakeDictionary));
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('I will receive it.'));
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('receive') + 2 } }));
    chooseFromMore('Look up word');
    expect(await screen.findByRole('dialog', { name: 'Look up “receive”' })).toBeTruthy();
  });

  it('Close document returns to the start screen', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    chooseFromMore('Close document');
    await waitFor(() => expect(controller.getState().document).toBeNull());
  });

  it('with no document, the menu has no Look up word or Close document', () => {
    renderShell(makeController({ modules: { ...DEFAULT_MODULES, wordLookup: true } }).controller);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent);
    expect(items.some((text) => /Look up|Close document/.test(text!))).toBe(false);
  });
});

describe('start screen', () => {
  it('says how to look a word up when word lookup is on', () => {
    renderShell(makeController({ modules: { ...DEFAULT_MODULES, wordLookup: true } }).controller);
    expect(screen.getByText(/put the cursor on a word and press Ctrl\+D/)).toBeTruthy();
  });
});

describe('done state', () => {
  it('nothing left: one calm line with the fixes applied, and no review-depth controls', async () => {
    const { controller } = makeController();
    renderShell(controller);
    // Two spaces: collapsed without a click (Task F4), so nothing is left to decide.
    await openAndWait(controller, () => controller.openText('I think the  cat sat on the mat.'));
    expect(controller.getState().session!.rankedDecisionCount()).toBe(0);
    expect(within(reviewPanel()).getByText('All clear: 1 fix applied, nothing left to decide.')).toBeTruthy();
    expect(within(reviewPanel()).queryByRole('group', { name: /Review depth/ })).toBeNull();
    expect(within(reviewPanel()).queryByRole('radiogroup', { name: /Review depth/ })).toBeNull();
    expect(within(reviewPanel()).queryByRole('slider')).toBeNull();
  });

  const UNCHECKED = "This document has text in a language Kashiro can't check yet. Only English text was checked.";

  it.each([
    ['Hindi and Bengali', 'यह एक छोटा सा परीक्षण है। हम कल बाज़ार गए थे।\n\nআমরা কাল বাজারে গিয়েছিলাম।'],
    ['Tamil', 'நாங்கள் நேற்று சந்தைக்குச் சென்றோம்.\n\nஇது ஒரு சிறிய சோதனை.'],
    ['Gujarati', 'અમે ગઈકાલે બજારમાં ગયા હતા.'],
    ['Urdu', 'ہم کل بازار گئے تھے۔'],
  ])('a %s document never gets the all-clear: it says only English was checked (review #4, F3 re-review M1)', async (_name, text) => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(text));
    expect(controller.getState().session!.rankedDecisionCount()).toBe(0);
    expect(within(reviewPanel()).getByRole('heading', { name: UNCHECKED })).toBeTruthy();
    expect(within(reviewPanel()).queryByText(/All clear/)).toBeNull();
    expect(english(controller.getState().announcement!.message)).toBe(`Check finished: nothing to decide. ${UNCHECKED}`);
  });

  it('a paragraph the checker threw on is named in a notice, and the rest is checked (Task F21d, review I-4)', async () => {
    /** The real linter, except that it throws (as Harper does when it panics) on a paragraph holding "BOOM". */
    const throwing = (l: RulesLinter): RulesLinter => ({
      get variant() {
        return l.variant;
      },
      lintParagraphs: async (paras, language) => {
        if (paras.some((p) => p.text.includes('BOOM'))) throw new Error('RuntimeError: unreachable');
        return l.lintParagraphs(paras, language);
      },
      lintSpelling: (paras, variant) => l.lintSpelling(paras, variant),
      addWords: (w) => l.addWords(w),
      setVariant: (v) => l.setVariant(v),
    });
    const controller = new SessionController({
      files: noFiles,
      createLinter: async (variant, words) => throwing(await createLinter(variant, words)),
      saveSettings: async () => {},
      settings: { ...defaultSettings('en-US'), preset: 'academic' },
    });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('I think the  cat sat on the mat.\n\nBOOM went the paragraph.'));
    expect(controller.getState().session!.uncheckedParagraphs()).toEqual([1]);
    expect(within(reviewPanel()).getByText('All clear: 1 fix applied, nothing left to decide.')).toBeTruthy();
    expect(within(reviewPanel()).getByText('One paragraph couldn’t be checked and was left as written.')).toBeTruthy();
    // Task F21b E2: the screen-reader announcement says so too.
    expect(english(controller.getState().announcement!.message)).toBe(
      'Check finished: nothing to decide. One paragraph couldn’t be checked and was left as written.',
    );
  });

  it('a mostly English document with a Hindi paragraph is all clear, with the same notice under it', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('I think the  cat sat on the mat. We will meet again next week.\n\nयह एक परीक्षण है।'));
    expect(within(reviewPanel()).getByText('All clear: 1 fix applied, nothing left to decide.')).toBeTruthy();
    expect(within(reviewPanel()).getByText(UNCHECKED)).toBeTruthy();
  });
});

// Task U3 fix 1: "detected" only when the text chose the variant; the fallback is the default.
describe('the English variant in the status bar and the toolbar', () => {
  const statusBar = () => document.querySelector('.statusbar')!.textContent;
  /** The variant menu's first choice: the variant the check chose itself. */
  const automatic = () => [...toolbar().querySelectorAll('option')].find((o) => / \((default|detected)\)$/.test(o.textContent ?? ''))?.textContent;

  it('says "(default)" when nothing in the text chose it, and "(detected)" when the spelling did', async () => {
    const { controller } = makeController({ fallbackVariant: 'Indian' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    expect(statusBar()).toContain('Indian English (default)');
    expect(automatic()).toBe('Indian (default)');
    await openAndWait(controller, () => controller.openText('The colour of the organised behaviour was odd.'));
    expect(statusBar()).toContain('English (detected)');
    expect(automatic()).toMatch(/ \(detected\)$/);
  });

  // Task F20 item 5 (owner): after picking American, the automatic choice read "American (detected)", but choosing
  // it cleared the pick and the re-check fell back to "Indian (default)".
  it('while a variant is picked, the automatic choice names no variant', async () => {
    const { controller } = makeController({ fallbackVariant: 'Indian' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    act(() => controller.setVariant('American'));
    await waitFor(() => expect(statusBar()).toContain('American English'));
    const select = within(toolbar()).getByRole('combobox', { name: /English/ }) as HTMLSelectElement;
    expect(select.value).toBe('American');
    expect(select.querySelector('option[value=""]')!.textContent).toBe('Automatic (detect from text)');
    expect(statusBar()).not.toMatch(/\((detected|default)\)/);
    act(() => controller.setVariant(null));
    await waitFor(() => expect(statusBar()).toContain('Indian English (default)'));
    expect(select.querySelector('option[value=""]')!.textContent).toBe('Indian (default)');
  });

  it.each([
    ['hi', 'अपने-आप (पाठ से पहचानें)'],
    ['bn', 'স্বয়ংক্রিয় (লেখা থেকে শনাক্ত)'],
  ] as const)('%s: the automatic choice is translated', async (language, label) => {
    const { controller } = makeController({ fallbackVariant: 'Indian', uiLanguage: language });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    act(() => controller.setVariant('American'));
    await waitFor(() => expect(toolbar().querySelector('option[value=""]')!.textContent).toBe(label));
  });
});
