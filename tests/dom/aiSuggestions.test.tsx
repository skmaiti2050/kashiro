// Task 13 UI: the AI suggestions group, "Improve this sentence" (card, toolbar, Ctrl+I, right-click), progress
// and Cancel, "No improvement suggested", "Choose helper suggestions to accept", the speed advice, and axe on each.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import axe from 'axe-core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Rewriter } from '@/engine/llm/suggest';
import { SessionController } from '@/ui/state/sessionController';
import { defaultSettings, type Settings } from '@/ui/state/settings';
import { buildDocx } from '../fixtures/make_docx';
import { deferred } from './fakeDictionary';
import { noFiles, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel, settingsTab } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const FIRST = 'We was late again.';
const FIRST_REWRITE = 'We were late again.';
const SECOND = 'The bus come at nine every morning.';
const SECOND_REWRITE = 'The bus came at nine every morning.';
/** AI rewrites on, with the model already timed on the mock's CPU build (no speed check gets in the way). */
const AI_ON: Partial<Settings> = {
  modelPath: 'C:/models/helper.gguf',
  modules: { ...DEFAULT_MODULES, aiRewrites: true },
  helperSpeed: { modelPath: 'C:/models/helper.gguf', seconds: 2.5, backend: 'cpu', gpuFallback: false },
};

/** A linter whose rules pass fails on any paragraph holding `word`: that check fails, and the session stays. */
function failingOn(word: string, linter: RulesLinter): RulesLinter {
  // Like Harper after a panic, every later call fails too, so the whole check fails (a single paragraph that
  // fails is only reported as unchecked since Task F21d).
  let broken = false;
  return {
    get variant() {
      return linter.variant;
    },
    lintParagraphs: (paras, language) => {
      broken ||= paras.some((p) => p.text.includes(word));
      return broken ? Promise.reject(new Error('the rules pass failed')) : linter.lintParagraphs(paras, language);
    },
    lintSpelling: (paras, variant) => linter.lintSpelling(paras, variant),
    addWords: (words) => linter.addWords(words),
    setVariant: (variant) => linter.setVariant(variant),
  };
}

/** A controller whose writing helper answers with `answer` and records what it was sent; its checks fail on `failCheckOn`. */
function aiController(answer: (text: string) => string | null | Promise<string | null>, settings: Partial<Settings> = AI_ON, failCheckOn?: string) {
  const sent: string[] = [];
  const rewriter: Rewriter = {
    async rewrite(text, _preset, _variant, signal) {
      sent.push(text);
      const reply = await answer(text);
      signal.throwIfAborted();
      return reply;
    },
  };
  const controller = new SessionController({
    files: noFiles,
    createLinter: async (variant, words) => {
      const linter = await createLinter(variant, words);
      return failCheckOn ? failingOn(failCheckOn, linter) : linter;
    },
    saveSettings: async () => {},
    startHelper: async () => ({ rewriter, stop: () => {}, backend: 'cpu', gpuFallback: false }),
    settings: { ...defaultSettings('en-US'), preset: 'business', ...settings },
  });
  return { controller, sent };
}

async function openText(controller: SessionController, text = `${FIRST}\n\n${SECOND}`) {
  renderShell(controller);
  await openAndWait(controller, () => controller.openText(text));
}

const aiGroup = () => within(reviewPanel()).getByRole('region', { name: 'AI suggestions' });
const editor = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
/** What the app's status regions (in the header) say. */
const announced = () => within(document.querySelector<HTMLElement>('.app-header')!).getAllByRole('status').map((region) => region.textContent);

async function audit(screenName: string): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  const results = await axe.run(document.body, { resultTypes: ['violations'] });
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${screenName}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(blocking).toEqual([]);
}

/** Puts the editor's cursor inside `text`. */
function cursorIn(text: string): EditorView {
  const view = editor();
  const at = view.state.doc.toString().indexOf(text);
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: at + 1 } });
  });
  return view;
}

describe('entry points follow the AI rewrites switch', () => {
  it('off: no AI group, no toolbar button, no card button, no Ctrl+I in the shortcuts', async () => {
    const { controller, sent } = aiController(() => null, { modules: DEFAULT_MODULES, modelPath: 'C:/models/helper.gguf' });
    await openText(controller);
    expect(within(reviewPanel()).queryByRole('region', { name: 'AI suggestions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Improve this sentence' })).toBeNull();
    fireEvent.keyDown(cursorIn('late').contentDOM, { key: 'i', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'F1' });
    expect(screen.queryByText('Ctrl+I')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('on: the group offers "Check how it reads"; the toolbar and the shortcuts sheet offer Ctrl+I', async () => {
    const { controller } = aiController(() => null);
    await openText(controller);
    expect(within(aiGroup()).getByRole('button', { name: 'Check how it reads' })).toBeTruthy();
    expect(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Improve this sentence' }).getAttribute('aria-keyshortcuts')).toBe('Control+I');
    await audit('AI group');
    fireEvent.keyDown(document.body, { key: 'F1' });
    expect(screen.getByText('Ctrl+I')).toBeTruthy();
    expect(screen.getByText('Improve the sentence at the cursor (AI helper)')).toBeTruthy();
  });
});

describe('"Improve this sentence"', () => {
  it('Ctrl+I in the text asks about the sentence at the cursor; the suggestion card shows "AI suggestion" and a before/after diff', async () => {
    const { controller, sent } = aiController((text) => (text === SECOND ? SECOND_REWRITE : null));
    await openText(controller);
    fireEvent.keyDown(cursorIn('every morning').contentDOM, { key: 'i', ctrlKey: true });
    await waitFor(() => expect(controller.getState().ai.ready).not.toBeNull());
    expect(sent).toEqual([SECOND]);
    // Looked up afresh each time: the AI card can replace the card shown before it.
    await waitFor(() => expect(reviewPanel().querySelector('.card .category')?.textContent).toContain('AI suggestion'));
    const card = reviewPanel().querySelector<HTMLElement>('.card')!;
    expect(card.querySelector('del')?.textContent).toBe(SECOND);
    expect(card.querySelector('ins')?.textContent).toBe(SECOND_REWRITE);
    expect(announced()).toContain('AI suggestion ready to review.');
    await audit('AI suggestion card');
  });

  it('the toolbar button asks about the sentence at the cursor; "No improvement suggested" shows and is announced', async () => {
    const { controller, sent } = aiController(() => null);
    await openText(controller);
    cursorIn('late');
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Improve this sentence' }));
    await waitFor(() => expect(within(aiGroup()).getByText('No improvement suggested for this sentence.')).toBeTruthy());
    expect(sent).toEqual([FIRST]);
    expect(announced()).toContain('No improvement suggested for this sentence.');
    await audit('no improvement');
  });

  it('a sentence with other-script words is not sent: the panel says the helper reads only checked English', async () => {
    const { controller, sent } = aiController(() => null);
    await openText(controller, 'We met Ravi at the मंदिर gate. It was late.');
    cursorIn('मंदिर');
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Improve this sentence' }));
    await waitFor(() => expect(within(aiGroup()).getByText('The AI helper works only on English text the proofreader checked, and this sentence isn’t.')).toBeTruthy());
    expect(sent).toEqual([]);
  });

  it('a review card offers it for its own sentence', async () => {
    const { controller, sent } = aiController(() => null);
    await openText(controller);
    const card = reviewPanel().querySelector<HTMLElement>('.card')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Improve this sentence' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect([FIRST, SECOND]).toContain(sent[0]);
  });

  it('right-click in read-only text offers it, even with word lookup off', async () => {
    const { controller, sent } = aiController(() => null, { ...AI_ON, modules: { ...DEFAULT_MODULES, aiRewrites: true, wordLookup: false } });
    renderShell(controller);
    const bytes = await buildDocx(`<w:p><w:r><w:t>${FIRST}</w:t></w:r></w:p>`);
    await openAndWait(controller, () => controller.openFile({ name: 'essay.docx', path: '/docs/essay.docx', bytes }));
    const view = editor();
    // A click in the read-only text leaves the page's caret there (the Menu key opens at it: no pointer position).
    const line = view.contentDOM.querySelector('.cm-line')!.firstChild!;
    act(() => window.getSelection()!.collapse(line, 3));
    fireEvent.contextMenu(view.contentDOM);
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: /Look up/ })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Improve this sentence' }));
    await waitFor(() => expect(sent).toEqual([FIRST]));
  });
});

describe('"Check how it reads": progress, Cancel and Accept all', () => {
  it('shows progress (not announced per sentence) with a keyboard-reachable Cancel that keeps what came back', async () => {
    const second = deferred<string | null>();
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : second.promise));
    await openText(controller, `${FIRST} ${SECOND}`);
    act(() => controller.ai.improveSentence(0, 0));
    act(() => controller.ai.improveSentence(0, FIRST.length + 2));
    const progress = await within(aiGroup()).findByRole('progressbar', { name: 'AI check progress' });
    expect(progress.getAttribute('aria-valuemax')).toBe('2');
    await waitFor(() => expect(progress.getAttribute('aria-valuenow')).toBe('1'));
    const cancel = within(aiGroup()).getByRole('button', { name: 'Cancel' });
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    await audit('AI progress');
    fireEvent.click(cancel);
    await act(async () => {
      second.resolve(SECOND_REWRITE);
      await controller.ai.settled();
    });
    expect(within(aiGroup()).queryByRole('progressbar')).toBeNull();
    expect(controller.getState().session!.candidates().filter((c) => c.source === 'llm').map((c) => c.replacements[0])).toEqual([FIRST_REWRITE]);
  });

  it('"Choose helper suggestions to accept" opens a preview with nothing ticked and applies the ticked ones on its click, as one undo step (Task F10)', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : text === SECOND ? SECOND_REWRITE : null));
    await openText(controller);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      controller.ai.improveSentence(1, 0);
      await controller.ai.settled();
    });
    const choose = within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (2)…' });
    fireEvent.click(choose);
    expect(controller.getState().session!.outputText(0)).toBe(FIRST); // the click opened the preview only
    const boxes = within(aiGroup()).getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes.map((b) => b.checked)).toEqual([false, false]);
    expect(within(aiGroup()).getByText('Nothing starts ticked. Tick each place you want to fix.')).toBeTruthy();
    expect(within(aiGroup()).getByRole<HTMLButtonElement>('button', { name: 'Apply 0 of 2' }).disabled).toBe(true);
    await audit('accept all preview, nothing ticked');
    for (const box of boxes) fireEvent.click(box);
    fireEvent.click(within(aiGroup()).getByRole('button', { name: /^Apply 2/ }));
    const session = controller.getState().session!;
    expect([session.outputText(0), session.outputText(1)]).toEqual([FIRST_REWRITE, SECOND_REWRITE]);
    fireEvent.click(screen.getByRole('button', { name: /Change log/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo all 2' }));
    expect([session.outputText(0), session.outputText(1)]).toEqual([FIRST, SECOND]);
  });

  // Task F17 (owner request): ticking each suggestion by hand is slow on a long document.
  it('"Tick all (2)" then Apply accepts every suggestion shown; "Untick all" disables Apply; ticking applies nothing', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : text === SECOND ? SECOND_REWRITE : null));
    await openText(controller);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      controller.ai.improveSentence(1, 0);
      await controller.ai.settled();
    });
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (2)…' }));
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Tick all (2)' }));
    expect(within(aiGroup()).getAllByRole<HTMLInputElement>('checkbox').map((b) => b.checked)).toEqual([true, true]);
    const session = controller.getState().session!;
    expect([session.outputText(0), session.outputText(1)]).toEqual([FIRST, SECOND]);
    await audit('accept all preview, all ticked');

    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Untick all' }));
    expect(within(aiGroup()).getByRole<HTMLButtonElement>('button', { name: 'Apply 0 of 2' }).disabled).toBe(true);
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Tick all (2)' }));
    fireEvent.click(within(aiGroup()).getByRole('button', { name: /^Apply 2/ }));
    expect([session.outputText(0), session.outputText(1)]).toEqual([FIRST_REWRITE, SECOND_REWRITE]);
  });

  it('a change to the text after "Tick all" still closes the preview and applies nothing', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : text === SECOND ? SECOND_REWRITE : null));
    await openText(controller);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      controller.ai.improveSentence(1, 0);
      await controller.ai.settled();
    });
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (2)…' }));
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Tick all (2)' }));

    act(() => controller.editText(`${FIRST}\n\n${SECOND}\n\nThe road was long.`));
    expect(within(aiGroup()).queryAllByRole('checkbox')).toEqual([]);
    await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });
    const session = controller.getState().session!;
    expect([session.outputText(0), session.outputText(1)]).toEqual([FIRST, SECOND]);
  });
});

describe('the Accept-all preview applies only what it showed (I2)', () => {
  it('a suggestion that arrives while the preview is open is not in it and is not applied', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : text === SECOND ? SECOND_REWRITE : null));
    await openText(controller);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      await controller.ai.settled();
    });
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (1)…' }));
    await act(async () => {
      controller.ai.improveSentence(1, 0); // arrives while the preview is open
      await controller.ai.settled();
    });
    expect(within(aiGroup()).queryByText(SECOND_REWRITE)).toBeNull();
    fireEvent.click(within(aiGroup()).getByRole('checkbox'));
    fireEvent.click(within(aiGroup()).getByRole('button', { name: /^Apply 1/ }));
    const session = controller.getState().session!;
    expect([session.outputText(0), session.outputText(1)]).toEqual([FIRST_REWRITE, SECOND]);
    const second = session.outcomes().find((o) => o.candidate.source === 'llm' && o.candidate.paraId === 1)!;
    expect(second.status).toBe('pending');
  });

  // Final F11 review I-1b, the same rule for this preview (Task F12): ids are offsets, so swapping two sentences of
  // the same length trades their suggestions' ids, and the user's tick would move to the suggestion they didn't tick.
  it('a re-check that puts another suggestion under a ticked id closes the preview and applies nothing', async () => {
    const OTHER = 'The bus come late.'; // as long as FIRST
    const OTHER_REWRITE = 'The bus came late.';
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : text === OTHER ? OTHER_REWRITE : null));
    await openText(controller, `${FIRST}\n\n${OTHER}`);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      controller.ai.improveSentence(1, 0);
      await controller.ai.settled();
    });
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (2)…' }));
    fireEvent.click(within(aiGroup()).getByRole('checkbox', { name: /were/ }));

    act(() => controller.editText(`${OTHER}\n\n${FIRST}`)); // the paragraphs swapped in one edit
    await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });
    const session = controller.getState().session!;
    expect(session.candidates().filter((c) => c.source === 'llm' && c.paraId === 0).map((c) => c.replacements[0])).toEqual([OTHER_REWRITE]);
    const tickedRows = within(aiGroup()).queryAllByRole<HTMLInputElement>('checkbox').filter((box) => box.checked).map((box) => box.closest('label')!.textContent);
    expect(tickedRows.filter((row) => !row!.includes('were'))).toEqual([]); // only the suggestion the user ticked
    expect(within(aiGroup()).queryAllByRole('checkbox')).toEqual([]);
    expect([session.outputText(0), session.outputText(1)]).toEqual([OTHER, FIRST]);
    expect(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (2)…' })).toBeTruthy();
  });

  // Final F12 review I-1c: the same sentence at the same offset in two swapped paragraphs gives the same suggestion under
  // the same id, so the preview stayed open and the user's tick moved to the sentence quoted on purpose. Owner decision
  // 2026-10-27 (Task F13): any change to the text closes the preview, and focus goes back to its button.
  it('two paragraphs with the same sentence swapped: the preview closes, nothing is applied, and focus goes to "Choose…"', async () => {
    const RAIN = `${FIRST} The rain had stopped.`;
    const QUOTE = `${FIRST} I quote "${FIRST}" on purpose.`;
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : null));
    await openText(controller, `${RAIN}\n\n${QUOTE}`);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      controller.ai.improveSentence(1, 0);
      await controller.ai.settled();
    });
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (2)…' }));
    const rain = within(aiGroup()).getByRole<HTMLInputElement>('checkbox', { name: /rain/ });
    fireEvent.click(rain);
    act(() => rain.focus());

    act(() => controller.editText(`${QUOTE}\n\n${RAIN}`)); // the paragraphs swapped in one edit
    await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });
    const tickedRows = within(aiGroup()).queryAllByRole<HTMLInputElement>('checkbox').filter((box) => box.checked).map((box) => box.closest('label')!.textContent);
    expect(tickedRows.filter((row) => !row!.includes('rain'))).toEqual([]); // only the sentence the user ticked
    expect(within(aiGroup()).queryAllByRole('checkbox')).toEqual([]);
    const choose = within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (2)…' });
    expect(document.activeElement).toBe(choose);

    fireEvent.click(choose);
    expect(within(aiGroup()).getAllByRole<HTMLInputElement>('checkbox').map((box) => box.checked)).toEqual([false, false]);
    const session = controller.getState().session!;
    expect([session.outputText(0), session.outputText(1)]).toEqual([QUOTE, RAIN]);
  });

  it('typing in another paragraph closes the preview', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : null));
    await openText(controller);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      await controller.ai.settled();
    });
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (1)…' }));
    fireEvent.click(within(aiGroup()).getByRole('checkbox'));

    act(() => controller.editText(`${FIRST}\n\n${SECOND} Then it rained.`));
    await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });
    expect(within(aiGroup()).queryAllByRole('checkbox')).toEqual([]);
    expect(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (1)…' })).toBeTruthy();
  });
});

/** Presses J until the current card's title matches `title`. */
function showCard(title: RegExp): void {
  for (let i = 0; i < 20; i++) {
    if (title.test(reviewPanel().querySelector('.card-title')?.textContent ?? '')) return;
    fireEvent.keyDown(reviewPanel(), { key: 'j' });
  }
  throw new Error(`No card titled ${title}`);
}

const cardPreview = () => reviewPanel().querySelector<HTMLElement>('.card-slot .batch-preview');
const cardRows = () => [...cardPreview()!.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
const offeredIds = (controller: SessionController) => {
  const { top, more } = controller.getState().session!.decisions();
  return [...top, ...more].flatMap((d) => d.candidateIds);
};

// Final F13 review M-6, I-2 and M-8 (Task F14): an edit made in place (the AI preview's Apply, a card's Apply) left the
// other open preview open, and a card then applied over an accepted rewrite reverted it.
describe('an edit from one preview closes the other (Task F14)', () => {
  it('the AI preview’s Apply closes the card preview, and the card no longer offers the place the rewrite replaced', async () => {
    const POST = 'I recieve post daily.';
    const CALLS = 'You recieve "sic" calls.';
    const REWRITE = 'Post reaches me daily.';
    const { controller } = aiController((text) => (text === POST ? REWRITE : null));
    await openText(controller, `${POST}\n\n${CALLS}`);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      await controller.ai.settled();
    });
    showCard(/recieve.*2 places/);
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    fireEvent.click(cardRows()[0]);
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (1)…' }));
    fireEvent.click(within(aiGroup()).getByRole('checkbox'));

    fireEvent.click(within(aiGroup()).getByRole('button', { name: /^Apply 1/ }));
    const session = controller.getState().session!;
    expect([session.outputText(0), session.outputText(1)]).toEqual([REWRITE, CALLS]);
    expect(cardPreview()).toBeNull();
    expect(offeredIds(controller)).not.toContain('0:2:9:Spelling');
    expect(offeredIds(controller)).toContain('1:4:11:Spelling');

    fireEvent.click(screen.getByRole('button', { name: /Change log/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect([session.outputText(0), session.outputText(1)]).toEqual([POST, CALLS]);
    expect(offeredIds(controller)).toEqual(expect.arrayContaining(['0:2:9:Spelling', '1:4:11:Spelling']));
  });

  it('the AI preview’s Apply in another sentence closes the card preview', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : null));
    await openText(controller, `${FIRST} I recieve mail.\n\nYou recieve "sic" calls.`);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      await controller.ai.settled();
    });
    showCard(/recieve.*2 places/);
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    fireEvent.click(cardRows()[0]);
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (1)…' }));
    fireEvent.click(within(aiGroup()).getByRole('checkbox'));

    fireEvent.click(within(aiGroup()).getByRole('button', { name: /^Apply 1/ }));
    expect(controller.getState().session!.outputText(0)).toBe(`${FIRST_REWRITE} I recieve mail.`);
    expect(cardPreview()).toBeNull();
    showCard(/recieve.*2 places/); // the same card, still offering both places
  });

  it('a card’s Apply in another sentence closes the AI preview', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : null));
    await openText(controller, `${FIRST} I recieve mail.\n\nYou recieve "sic" calls.`);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      await controller.ai.settled();
    });
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (1)…' }));
    fireEvent.click(within(aiGroup()).getByRole('checkbox'));
    showCard(/recieve/);
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    fireEvent.click(cardRows()[0]);

    fireEvent.click(cardPreview()!.querySelector<HTMLButtonElement>('button.primary')!);
    const session = controller.getState().session!;
    expect(session.outputText(0)).toBe(`${FIRST} I receive mail.`);
    expect(within(aiGroup()).queryAllByRole('checkbox')).toEqual([]);
    expect(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (1)…' })).toBeTruthy();
  });

  it('rejecting a card changes no text, so the AI preview stays open with its tick', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : null));
    await openText(controller, `${FIRST} I recieve mail.\n\nYou recieve "sic" calls.`);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      await controller.ai.settled();
    });
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (1)…' }));
    fireEvent.click(within(aiGroup()).getByRole('checkbox'));
    showCard(/recieve/);

    fireEvent.click(reviewPanel().querySelector<HTMLButtonElement>('.card button[data-key~="reject"]')!);
    expect(controller.getState().session!.outcomes().some((o) => o.status === 'rejected')).toBe(true);
    expect(within(aiGroup()).getAllByRole<HTMLInputElement>('checkbox').map((box) => box.checked)).toEqual([true]);
  });

  // Pins the group's `checking` input: here only `checking` moves (no new session, no text change).
  it('a preview opened while typed text waits for its check closes when that check fails', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : null), AI_ON, 'Zzbreak');
    await openText(controller);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      await controller.ai.settled();
    });
    const session = controller.getState().session!;
    act(() => controller.editText(`${FIRST}\n\n${SECOND} Zzbreak`));
    expect(controller.getState().checking).toBe(true);
    fireEvent.click(within(aiGroup()).getByRole('button', { name: 'Choose helper suggestions to accept (1)…' }));
    fireEvent.click(within(aiGroup()).getByRole('checkbox'));

    await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });
    expect(controller.getState().error).not.toBeNull();
    expect(controller.getState().session).toBe(session);
    expect(within(aiGroup()).queryAllByRole('checkbox')).toEqual([]);
    expect(session.outputText(0)).toBe(FIRST);
  });
});

describe('Settings', () => {
  it('says that AI suggestions already shown stay after AI rewrites are switched off', async () => {
    const { controller } = aiController(() => null);
    await openText(controller);
    fireEvent.keyDown(document.body, { key: ',', ctrlKey: true });
    settingsTab('Modules');
    expect(within(screen.getByRole('dialog')).getByText('AI suggestions already shown stay until you decide them, even with AI rewrites off.')).toBeTruthy();
  });
});

describe('speed advice', () => {
  it('a slow PC is told in plain words, in the group and in Settings, with the GPU note', async () => {
    const helperSpeed = { modelPath: 'C:/models/helper.gguf', seconds: 7.04, backend: 'cpu' as const, gpuFallback: true };
    const { controller } = aiController(() => null, { ...AI_ON, helperSpeed });
    await openText(controller);
    const advice = /^This PC is slow for AI rewrites \(about 7 s per sentence\)\. .* The graphics card \(GPU\) build did not start/;
    expect(within(aiGroup()).getByText(advice)).toBeTruthy();
    await audit('speed advice');
    fireEvent.keyDown(document.body, { key: ',', ctrlKey: true });
    settingsTab('Modules');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(advice)).toBeTruthy();
    expect(within(dialog).getByText('About 7 s per sentence on this PC.')).toBeTruthy();
    await audit('speed advice in Settings');
  });
});
