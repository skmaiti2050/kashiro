/**
 * English-only labelling (#2a): the interface says "English proofreading", marks each paragraph it set aside
 * "Not checked", and counts them in the review panel.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
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
