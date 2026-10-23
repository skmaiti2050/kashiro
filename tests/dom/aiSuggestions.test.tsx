// Task 13 UI: the AI suggestions group, "Improve this sentence" (card, toolbar, Ctrl+I, right-click), progress
// and Cancel, "No improvement suggested", "Accept all helper suggestions", the speed advice, and axe on each.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import axe from 'axe-core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { createLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Rewriter } from '@/engine/llm/suggest';
import { SessionController } from '@/ui/state/sessionController';
import { defaultSettings, type Settings } from '@/ui/state/settings';
import { buildDocx } from '../fixtures/make_docx';
import { deferred } from './fakeDictionary';
import { noFiles, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const FIRST = 'We was late again.';
const FIRST_REWRITE = 'We were late again.';
const SECOND = 'The bus come at nine every morning.';
const SECOND_REWRITE = 'The bus came at nine every morning.';
const AI_ON: Partial<Settings> = { modelPath: 'C:/models/helper.gguf', modules: { ...DEFAULT_MODULES, aiRewrites: true } };

/** A controller whose writing helper answers with `answer` and records what it was sent. */
function aiController(answer: (text: string) => string | null | Promise<string | null>, settings: Partial<Settings> = AI_ON) {
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
    createLinter: (variant, words) => createLinter(variant, words),
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
    const card = reviewPanel().querySelector<HTMLElement>('.card')!;
    await waitFor(() => expect(card.querySelector('.category')?.textContent).toContain('AI suggestion'));
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

  it('"Accept all helper suggestions" opens a preview and applies only on its click, as one undo step', async () => {
    const { controller } = aiController((text) => (text === FIRST ? FIRST_REWRITE : text === SECOND ? SECOND_REWRITE : null));
    await openText(controller);
    await act(async () => {
      controller.ai.improveSentence(0, 0);
      controller.ai.improveSentence(1, 0);
      await controller.ai.settled();
    });
    const acceptAll = within(aiGroup()).getByRole('button', { name: 'Accept all helper suggestions (2)' });
    fireEvent.click(acceptAll);
    expect(controller.getState().session!.outputText(0)).toBe(FIRST); // the click opened the preview only
    await audit('accept all preview');
    fireEvent.click(within(aiGroup()).getByRole('button', { name: /^Apply 2/ }));
    const session = controller.getState().session!;
    expect([session.outputText(0), session.outputText(1)]).toEqual([FIRST_REWRITE, SECOND_REWRITE]);
    fireEvent.click(screen.getByRole('button', { name: /Change log/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo all 2' }));
    expect([session.outputText(0), session.outputText(1)]).toEqual([FIRST, SECOND]);
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
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(advice)).toBeTruthy();
    expect(within(dialog).getByText('About 7 s per sentence on this PC.')).toBeTruthy();
    await audit('speed advice in Settings');
  });
});
