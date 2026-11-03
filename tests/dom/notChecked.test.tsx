/**
 * English-only labelling (#2a): the interface says "English proofreading", marks each paragraph it set aside
 * "Not checked", and counts them in the review panel.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { createTranslator } from '@/ui/i18n/translator';
import { makeController, warmLinter } from './harness';
import { english } from '../ui/english';
import { chooseFromMore, openAndWait, renderShell, reviewPanel, settingsTab } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);
afterEach(() => vi.restoreAllMocks());

const ENGLISH = 'The cat sat on the mat.';
const HINDI = 'यह एक छोटा सा परीक्षण है।';
const BENGALI = 'আমরা কাল বাজারে গিয়েছিলাম।';
const MIXED_DOCUMENT = `${ENGLISH}\n\n${HINDI}\n\n${BENGALI}`;

const ABOUT_LINE = 'Kashiro proofreads English. Text in other scripts is shown but not checked.';
const markers = () => [...document.querySelectorAll<HTMLElement>('.cm-not-checked')];

describe('the "Not checked" marker beside a paragraph that was set aside', () => {
  it('each Hindi or Bengali paragraph has a quiet visual-only "Not checked" label; the English one has none', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(MIXED_DOCUMENT));
    expect(markers().map((m) => m.textContent)).toEqual(['Not checked', 'Not checked']);
    // Inside the text box the marker's name would be dropped or read twice: screen readers get the panel's count line and the announcement.
    for (const marker of markers()) {
      expect(marker.getAttribute('aria-hidden')).toBe('true');
      expect(marker.hasAttribute('role')).toBe(false);
      expect(marker.hasAttribute('aria-label')).toBe(false);
    }
    expect(screen.queryAllByRole('note')).toEqual([]);
  });

  it('the completion announcement says text in other scripts was not checked, also when only some paragraphs were', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`${ENGLISH} We will meet again next week.\n\n${HINDI}`));
    expect(english(controller.getState().announcement!.message)).toBe(
      'Check finished: nothing to decide. Kashiro proofreads English. Text in other scripts was not checked.',
    );
  });

  it('sits before its paragraph and is no part of the text: the document, its offsets and the copied text are unchanged', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(MIXED_DOCUMENT));
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    expect(view.state.doc.toString()).toBe(MIXED_DOCUMENT);
    expect(controller.getState().document!.text).toBe(MIXED_DOCUMENT);
    const [first] = markers();
    expect(first.nextElementSibling?.textContent).toBe(HINDI);
    expect(first.closest('.cm-line')).toBeNull();
  });

  it('a document in English alone has none', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`${ENGLISH}\n\nWe will meet again next week.`));
    expect(markers()).toEqual([]);
  });

  it('follows an edit: a paragraph turned into English loses its marker', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`${ENGLISH}\n\n${HINDI}`));
    expect(markers()).toHaveLength(1);
    await openAndWait(controller, () => controller.openText(`${ENGLISH}\n\nWe will meet again next week.`));
    expect(markers()).toEqual([]);
  });
});

const ringText = () => [...document.querySelectorAll<HTMLElement>('.cm-focus')].map((el) => el.textContent).join('');
const shownLine = () => document.querySelector<HTMLElement>('aside.review p[aria-live="polite"]')?.textContent ?? null;

describe('"Show next" outlines and names the place it moves to', () => {
  it('Show next outlines the place it moves to, like a card', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(MIXED_DOCUMENT));
    const next = within(reviewPanel()).getByRole('button', { name: 'Show next' });
    act(() => fireEvent.click(next));
    expect(ringText()).toBe(HINDI);
    act(() => fireEvent.click(next));
    expect(ringText()).toBe(BENGALI);
  });

  it('Show next names the place: "1 of 2" and its text, and wraps to 1 after the last', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(MIXED_DOCUMENT));
    expect(shownLine()).toBeNull();
    const next = within(reviewPanel()).getByRole('button', { name: 'Show next' });
    act(() => fireEvent.click(next));
    expect(shownLine()).toBe(`1 of 2: “${HINDI}”`);
    act(() => fireEvent.click(next));
    expect(shownLine()).toBe(`2 of 2: “${BENGALI}”`);
    act(() => fireEvent.click(next));
    expect(shownLine()).toBe(`1 of 2: “${HINDI}”`);
  });

  it('a long passage is shortened in the panel line', async () => {
    const long = 'यह एक छोटा सा परीक्षण है जो बहुत लंबा लिखा गया है ताकि कट जाए।';
    expect(long.length).toBeGreaterThan(40);
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`${ENGLISH}\n\n${long}`));
    act(() => fireEvent.click(within(reviewPanel()).getByRole('button', { name: 'Show next' })));
    expect(shownLine()).toBe(`1 of 1: “${long.slice(0, 40)}…”`);
  });

  it('after an edit above it, the outline still covers the passage', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(MIXED_DOCUMENT));
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: 0, insert: 'Big ' }, userEvent: 'input.type' }));
    await waitFor(() => expect(controller.getState().phase).toBe('ready'), { timeout: 10000 });
    await waitFor(() => expect(controller.getState().document!.text.startsWith('Big ')).toBe(true));
    act(() => fireEvent.click(within(reviewPanel()).getByRole('button', { name: 'Show next' })));
    expect(ringText()).toBe(HINDI);
  });
});

describe('the review panel counts the paragraphs that were not checked', () => {
  it('says how many, and "Show next" moves to each one in turn and wraps', async () => {
    const scrolled = vi.spyOn(EditorView, 'scrollIntoView');
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(MIXED_DOCUMENT));
    const panel = within(reviewPanel());
    expect(panel.getByText("2 paragraphs aren't in English and were not checked.")).toBeTruthy();
    const starts = [MIXED_DOCUMENT.indexOf(HINDI), MIXED_DOCUMENT.indexOf(BENGALI)];
    scrolled.mockClear();
    const next = panel.getByRole('button', { name: 'Show next' });
    for (let i = 0; i < 3; i++) act(() => fireEvent.click(next));
    expect(scrolled.mock.calls.map(([position]) => position)).toEqual([starts[0], starts[1], starts[0]]);
  });

  it('says it in the singular for one paragraph', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`${ENGLISH} We will meet again next week.\n\n${HINDI}`));
    expect(within(reviewPanel()).getByText("1 paragraph isn't in English and was not checked.")).toBeTruthy();
  });

  it('a document that is mostly another script never gets the all-clear, and the count stays under it', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`${HINDI}\n\n${BENGALI}`));
    const panel = within(reviewPanel());
    expect(panel.getByRole('heading', { name: ABOUT_LINE })).toBeTruthy();
    expect(panel.queryByText(/All clear/)).toBeNull();
    expect(panel.getByText("2 paragraphs aren't in English and were not checked.")).toBeTruthy();
  });

  it('shows nothing, and no button, when every paragraph was checked', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(ENGLISH));
    expect(within(reviewPanel()).queryByRole('button', { name: 'Show next' })).toBeNull();
  });
});

const PASSAGE_WORD = 'नमस्ते';
const WITH_PASSAGE = `She said ${PASSAGE_WORD} and left the room.`;
const WITH_FRENCH = "We met. C'est la vie, mon ami.";
/** Enough English that the Hindi paragraph beside it does not make the whole document "mostly another script". */
const PASSAGE_AND_HINDI = `${WITH_PASSAGE} We will meet again next week, and then we will go home.\n\n${HINDI}`;
const passageMarks = () => [...document.querySelectorAll<HTMLElement>('.cm-not-checked-passage')];

describe('a dotted underline under a passage that was not checked (#29)', () => {
  it('marks the other-script word with a quiet underline and a title, unlike the wavy flags', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(WITH_PASSAGE));
    const [mark, ...rest] = passageMarks();
    expect(rest).toEqual([]);
    expect(mark.textContent).toBe(PASSAGE_WORD);
    expect(mark.getAttribute('title')).toBe('Not checked: Kashiro proofreads English only');
    expect(mark.classList.contains('cm-pending')).toBe(false);
  });

  it('marks a sentence in another language too', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(WITH_FRENCH));
    // Other marks (a flag inside the sentence) may split the underline into pieces.
    expect(passageMarks().map((m) => m.textContent).join('')).toBe("C'est la vie, mon ami.");
  });

  it('is no part of the text: the document and the editor text are unchanged', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(WITH_PASSAGE));
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    expect(view.state.doc.toString()).toBe(WITH_PASSAGE);
    expect(controller.getState().document!.text).toBe(WITH_PASSAGE);
  });

  it('keeps the English flags around it, and follows an edit that removes the word', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('She said नमस्ते and left teh room.'));
    expect(document.querySelectorAll('.cm-pending').length).toBeGreaterThan(0);
    expect(passageMarks()).toHaveLength(1);
    await openAndWait(controller, () => controller.openText('She said hello and left the room.'));
    expect(passageMarks()).toEqual([]);
  });
});

describe('the panel counts passages that were not checked (#29)', () => {
  it('passages only: says so, and the heading says the English text is clear', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(WITH_PASSAGE));
    const panel = within(reviewPanel());
    expect(panel.getByRole('heading', { name: 'All clear in the English text' })).toBeTruthy();
    expect(panel.getByText("1 passage isn't in English and was not checked.")).toBeTruthy();
  });

  it('says it in the plural', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`${WITH_PASSAGE} ${WITH_FRENCH}`));
    expect(within(reviewPanel()).getByText("2 passages aren't in English and were not checked.")).toBeTruthy();
  });

  it('paragraphs and passages together make one line', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(PASSAGE_AND_HINDI));
    expect(within(reviewPanel()).getByText("1 paragraph and 1 passage aren't in English and were not checked.")).toBeTruthy();
  });

  it('set-aside paragraphs only: the heading is the all-clear in the English text, with the existing line', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`${ENGLISH} We will meet again next week.\n\n${HINDI}`));
    const panel = within(reviewPanel());
    expect(panel.getByRole('heading', { name: 'All clear in the English text' })).toBeTruthy();
    expect(panel.getByText("1 paragraph isn't in English and was not checked.")).toBeTruthy();
  });

  it('"Show next" steps through paragraphs and passages in document order, to the passage itself, and wraps', async () => {
    const scrolled = vi.spyOn(EditorView, 'scrollIntoView');
    const { controller } = makeController();
    renderShell(controller);
    const text = PASSAGE_AND_HINDI;
    await openAndWait(controller, () => controller.openText(text));
    scrolled.mockClear();
    const next = within(reviewPanel()).getByRole('button', { name: 'Show next' });
    for (let i = 0; i < 3; i++) act(() => fireEvent.click(next));
    const passageStart = text.indexOf(PASSAGE_WORD);
    const hindiStart = text.indexOf(HINDI);
    expect(scrolled.mock.calls.map(([position]) => position)).toEqual([passageStart, hindiStart, passageStart]);
  });

  it('a document that is mostly another script keeps the "English only" heading', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`${HINDI}\n\n${BENGALI}`));
    const panel = within(reviewPanel());
    expect(panel.getByRole('heading', { name: ABOUT_LINE })).toBeTruthy();
    expect(panel.queryByText(/Nothing to check/)).toBeNull();
  });

  it('a document of one script-free line has no count and no "Show next"', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(ENGLISH));
    const panel = within(reviewPanel());
    expect(panel.getByRole('heading', { name: /^All clear/ }).textContent).not.toMatch(/English text/);
    expect(panel.queryByText(/not checked/)).toBeNull();
  });
});

describe('what the completion announcement says was not checked (#29)', () => {
  it('a passage in an English paragraph: "Some text isn\'t in English and was not checked."', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(WITH_PASSAGE));
    expect(english(controller.getState().announcement!.message)).toBe(
      "Check finished: nothing to decide. Some text isn't in English and was not checked.",
    );
  });

  it('an emoji-only document: "nothing to check, no English words"', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('🎉🎉'));
    expect(english(controller.getState().announcement!.message)).toBe('Check finished: nothing to check, no English words.');
  });

  it('an empty document says "Nothing to check: no English words" in the panel', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(''));
    expect(within(reviewPanel()).getByRole('heading', { name: 'Nothing to check: no English words' })).toBeTruthy();
  });
});

describe('the passage underline after an accepted edit earlier in the paragraph (#29)', () => {
  it('still sits on the passage text', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`We recieved ${PASSAGE_WORD} and left.`));
    const typo = controller.getState().session!.candidates().find((c) => c.original === 'recieved')!;
    act(() => controller.accept(typo.id));
    expect(document.querySelector('.cm-new')?.textContent).toBe('received');
    expect(passageMarks().map((m) => m.textContent).join('')).toBe(PASSAGE_WORD);
  });
});

describe('the interface says English proofreading', () => {
  it('the toolbar chip reads "English proofreading" and keeps the variant menu', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(ENGLISH));
    const chip = screen.getByRole('toolbar').querySelector<HTMLElement>('.chip')!;
    expect(within(chip).getByText('English proofreading')).toBeTruthy();
    expect(within(chip).getByRole('combobox')).toBeTruthy();
  });

  it('Settings › Language says proofreading is English only', async () => {
    const { controller } = makeController();
    renderShell(controller);
    chooseFromMore('Settings');
    settingsTab('Language');
    expect(within(screen.getByRole('dialog')).getByText(/Kashiro proofreads English only/)).toBeTruthy();
  });

  it('About says Kashiro proofreads English and shows other scripts unchecked', async () => {
    const { controller } = makeController();
    renderShell(controller);
    chooseFromMore('About');
    // The dialog loads on demand.
    expect(within(await screen.findByRole('dialog')).getByText(ABOUT_LINE)).toBeTruthy();
  });
});

describe.each(['hi', 'bn'] as const)('in %s', (language) => {
  const own = createTranslator(language, []);
  const english = createTranslator('en', []);

  it('every new string has its own translation', () => {
    for (const key of ['doc.notChecked','panel.showNextOther', 'toolbar.english', 'about.englishOnly', 'panel.englishOnly', 'language.hint'] as const) {
      expect(own.t(key), key).not.toBe(english.t(key));
    }
    expect(own.t('panel.otherScript', { count: 2 })).not.toBe(english.t('panel.otherScript', { count: 2 }));
    for (const key of ['doc.passageNotChecked', 'panel.allClearEnglish', 'panel.nothingToCheck'] as const) expect(own.t(key), key).not.toBe(english.t(key));
    expect(own.t('panel.passages', { count: 2 })).not.toBe(english.t('panel.passages', { count: 2 }));
    const both = { paragraphs: 2, passages: 3 };
    expect(own.t('panel.paragraphsAndPassages', both)).not.toBe(english.t('panel.paragraphsAndPassages', both));
  });

  it('the passage underline, its title, the headings and the lines render in the UI language', async () => {
    cleanup();
    const { controller } = makeController({ uiLanguage: language });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(PASSAGE_AND_HINDI));
    expect(passageMarks()[0].getAttribute('title')).toBe(own.t('doc.passageNotChecked'));
    const panel = within(screen.getByRole('complementary', { name: own.t('panel.label') }));
    expect(panel.getByRole('heading', { name: own.t('panel.allClearEnglish') })).toBeTruthy();
    expect(panel.getByText(own.t('panel.paragraphsAndPassages', { paragraphs: 1, passages: 1 }))).toBeTruthy();
  });

  it('the marker, the panel line and its button render in the UI language', async () => {
    cleanup();
    const { controller } = makeController({ uiLanguage: language });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(MIXED_DOCUMENT));
    expect(markers().map((m) => m.textContent)).toEqual([own.t('doc.notChecked'), own.t('doc.notChecked')]);
    const panel = screen.getByRole('complementary', { name: own.t('panel.label') });
    expect(within(panel).getByText(own.t('panel.otherScript', { count: 2 }))).toBeTruthy();
    expect(within(panel).getByRole('button', { name: own.t('panel.showNextOther') })).toBeTruthy();
  });
});
