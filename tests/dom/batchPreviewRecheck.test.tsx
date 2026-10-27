import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { moveLineUp, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { SIMPLE_FIXES_ID, type Decision } from '@/engine/decisions';
import type { SessionController } from '@/ui/state/sessionController';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** The batch decision `pick` names, in the session as it is now. */
function batchDecision(controller: SessionController, pick: (id: string) => boolean): Decision {
  const { top, more } = controller.getState().session!.decisions();
  const decision = [...top, ...more].find((d) => d.kind === 'batch' && pick(d.id));
  if (!decision) throw new Error('No such batch card');
  return decision;
}

/** Presses J until the current card's title matches `title`. */
function showCard(title: RegExp): void {
  for (let i = 0; i < 20; i++) {
    if (title.test(reviewPanel().querySelector('.card-title')?.textContent ?? '')) return;
    fireEvent.keyDown(reviewPanel(), { key: 'j' });
  }
  throw new Error(`No card titled ${title}`);
}

/** Types `text` into the document and waits for its re-check to finish. */
async function retype(controller: SessionController, text: string) {
  act(() => controller.editText(text));
  await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });
}

/** The members the open preview shows ticked (it lists the card's members in order). */
function tickedInPreview(decision: Decision): string[] {
  const boxes = [...reviewPanel().querySelectorAll<HTMLInputElement>('.batch-preview input[type=checkbox]')];
  return boxes.flatMap((box, i) => (box.checked ? [decision.candidateIds[i]] : []));
}

/** The members the engine starts ticked: on the simple-fixes card, an allowlisted doubling; elsewhere none. */
const engineTicks = (decision: Decision) => decision.candidateIds.filter((id) => !decision.startUnticked?.includes(id));

/** The members the engine leaves unticked that the open preview shows ticked. */
const tickedAgainstTheEngine = (decision: Decision) => tickedInPreview(decision).filter((id) => !engineTicks(decision).includes(id));

const isSimpleFixes = (id: string) => id === SIMPLE_FIXES_ID;

// Final F10 review I-1: the preview kept its tick state when a re-check gave the card's members new ids under the
// same card id, so places the user never ticked showed ticked and Enter applied them.
describe('an open batch preview after a re-check changes its members (Task F11)', () => {
  it.each([
    ['typed before both (the ids shift)', 'I recieve mail. You recieve calls.', 'Today I recieve mail. You recieve calls.', /recieve/, (id: string) => id.includes('recieve')],
    ['a third use typed', 'I recieve mail. You recieve calls.', 'I recieve mail. You recieve calls. They recieve gifts.', /recieve/, (id: string) => id.includes('recieve')],
    [
      'THAT THAT, typed before and a third',
      'He said THAT THAT was fine. I knew THAT THAT was wrong.',
      'Yes. He said THAT THAT was fine. I knew THAT THAT was wrong. THAT THAT is it.',
      /THAT THAT/,
      (id: string) => !isSimpleFixes(id),
    ],
    ['simple-fixes card, phonics "a a"', 'Say the sounds: a a, b b.', 'Now say the sounds: a a, b b.', /simple fix/i, isSimpleFixes],
    ['simple-fixes card, a slip and phonics "a a"', 'It was the the end. Say a a, b b.', 'So it was the the end. Say a a, b b.', /simple fix/i, isSimpleFixes],
  ])('%s: nothing the engine leaves unticked shows ticked, and Enter changes nothing', async (_name, before, after, title, pick) => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(before));
    showCard(title);
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    expect(reviewPanel().querySelector('.batch-preview')).toBeTruthy();

    await retype(controller, after);
    expect(tickedAgainstTheEngine(batchDecision(controller, pick))).toEqual([]);

    // The preview closed with the re-check, so Enter re-opens it with the engine's current ticks.
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    const now = batchDecision(controller, pick);
    expect(reviewPanel().querySelector('.batch-preview')).toBeTruthy();
    expect(tickedInPreview(now)).toEqual(engineTicks(now));
    const session = controller.getState().session!;
    expect(session.outputText(0)).toBe(after);
    expect(session.outcomes().filter((o) => o.status === 'applied')).toEqual([]);
  });

  // Task F12: the preview is kept only when every member reads as it did: the same id, text, fixes and engine tick.
  it.each([
    ['review batch, user ticked one', 'I recieve mail. You recieve calls.', /recieve/, [true, false]],
    ['simple-fixes card, user unticked the slip', 'It was the the end. Say a a, b b.', /simple fix/i, [false, false]],
  ])('%s: a re-check that leaves every member as it was keeps the preview and the user’s ticks', async (_name, text, title, ticks) => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(text));
    showCard(title);
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    fireEvent.click(reviewPanel().querySelector<HTMLInputElement>('.batch-preview input[type=checkbox]')!);

    await retype(controller, `${text}\n\nThe road was long.`);
    const boxes = [...reviewPanel().querySelectorAll<HTMLInputElement>('.batch-preview input[type=checkbox]')];
    expect(boxes.map((box) => box.checked)).toEqual(ticks);
  });
});

/** The document's CodeMirror editor. */
const editor = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;

/** Runs `edit` in the editor, as its key press or paste would, and waits for the re-check it starts. */
async function inEditor(controller: SessionController, edit: (view: EditorView) => void) {
  act(() => edit(editor()));
  await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });
}

/** Alt+↑ on line 2: the line moves above line 1. */
const moveLine2Up = (view: EditorView) => {
  view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
  moveLineUp(view);
};

/** A paste over the first five characters. */
const pasteAtStart = (text: string) => (view: EditorView) => view.dispatch({ changes: { from: 0, to: 5, insert: text }, userEvent: 'input.paste' });

// Final F11 review I-1b: ids are offsets, so an edit that puts other words at the same offsets kept the preview open
// with ticks the user gave to other text. A phonics "An an" then showed ticked, and Enter gave "An. Bn bn.".
describe('an open batch preview after a re-check puts other text under the same ids (Task F12)', () => {
  it.each([
    ['two lines swapped (Alt+↑)', 'Of of. Bn bn.\nAn an. Bn bn.', null, moveLine2Up, 'An an. Bn bn.\nOf of. Bn bn.'],
    ['a paste over the span', 'Of of. Bn bn.', null, pasteAtStart('An an'), 'An an. Bn bn.'],
    ['an undo that restores other words', 'An an. Bn bn.', pasteAtStart('Of of'), undo, 'An an. Bn bn.'],
  ])('%s: the preview closes, and Enter re-opens it with the engine’s ticks', async (_name, text, beforePreview, edit, after) => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(text));
    if (beforePreview) await inEditor(controller, beforePreview);
    showCard(/simple fix/i);
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    const opened = batchDecision(controller, isSimpleFixes);
    expect(tickedInPreview(opened)).toEqual(engineTicks(opened));

    await inEditor(controller, edit);
    const session = controller.getState().session!;
    expect(session.outputText(0)).toBe(after);
    const now = batchDecision(controller, isSimpleFixes);
    expect(now.candidateIds).toEqual(opened.candidateIds); // the same ids, other words under them
    expect(tickedAgainstTheEngine(now)).toEqual([]);
    expect(reviewPanel().querySelector('.batch-preview')).toBeNull();

    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    expect(tickedInPreview(now)).toEqual(engineTicks(now));
    expect(session.outputText(0)).toBe(after);
    expect(session.outcomes().filter((o) => o.status === 'applied')).toEqual([]);
  });
});
