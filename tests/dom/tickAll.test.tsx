// Task F17 (owner request): "Tick all (N)" and "Untick all" in a card's batch preview. A "216 simple fixes" card meant
// 216 ticks by hand. They are explicit actions: nothing starts ticked by them, Apply is still its own press, the engine's
// starting ticks stay as they are, and any change to the text still closes the preview (Tasks F13 and F14).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { SIMPLE_FIXES_ID, type Decision } from '@/engine/decisions';
import type { SessionController } from '@/ui/state/sessionController';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const REVIEW_BATCH = 'I recieve mail. You recieve calls.';
const SIMPLE_FIXES = 'It was the the end. Say a a, b b.';

/** The batch decision `pick` names, in the session as it is now. */
function batchDecision(controller: SessionController, pick: (id: string) => boolean): Decision {
  const { top, more } = controller.getState().session!.decisions();
  const decision = [...top, ...more].find((d) => d.kind === 'batch' && pick(d.id));
  if (!decision) throw new Error('No such batch card');
  return decision;
}

const isSimpleFixes = (id: string) => id === SIMPLE_FIXES_ID;
const isReviewBatch = (id: string) => !isSimpleFixes(id);

/** Presses J until the current card's title matches `title`, then Enter to open its preview. */
function openPreviewOf(title: RegExp): void {
  for (let i = 0; i < 20 && !title.test(reviewPanel().querySelector('.card-title')?.textContent ?? ''); i++) fireEvent.keyDown(reviewPanel(), { key: 'j' });
  fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
  expect(preview()).not.toBeNull();
}

const preview = () => reviewPanel().querySelector<HTMLElement>('.batch-preview');
const boxes = () => [...reviewPanel().querySelectorAll<HTMLInputElement>('.batch-preview input[type=checkbox]')].map((box) => box.checked);
/** The members the engine starts ticked: on the simple-fixes card, an allowlisted doubling; elsewhere none. */
const engineTicks = (decision: Decision) => decision.candidateIds.map((id) => !decision.startUnticked?.includes(id));

async function opened(text: string) {
  const { controller } = makeController({ preset: 'blog' });
  renderShell(controller);
  await openAndWait(controller, () => controller.openText(text));
  return controller;
}

describe('"Tick all" and "Untick all" in a card’s preview (Task F17)', () => {
  it('a review batch: Tick all ticks every place, the engine’s ticks stay, and Apply applies them all', async () => {
    const controller = await opened(REVIEW_BATCH);
    openPreviewOf(/recieve/);
    const before = batchDecision(controller, isReviewBatch);
    expect(boxes()).toEqual([false, false]);

    fireEvent.click(within(preview()!).getByRole('button', { name: 'Tick all (2)' }));
    expect(boxes()).toEqual([true, true]);
    const session = controller.getState().session!;
    expect(session.outputText(0)).toBe(REVIEW_BATCH); // ticking applies nothing
    expect(batchDecision(controller, isReviewBatch).startUnticked).toEqual(before.candidateIds);

    fireEvent.click(within(preview()!).getByRole('button', { name: /^Apply 2/ }));
    expect(session.outputText(0)).toBe('I receive mail. You receive calls.');
  });

  it('the simple-fixes card: Untick all disables Apply', async () => {
    const controller = await opened(SIMPLE_FIXES);
    openPreviewOf(/simple fix/i);
    const count = batchDecision(controller, isSimpleFixes).candidateIds.length;
    fireEvent.click(within(preview()!).getByRole('button', { name: 'Untick all' }));
    expect(boxes()).toEqual(Array(count).fill(false));
    expect(within(preview()!).getByRole<HTMLButtonElement>('button', { name: new RegExp(`^Apply 0 of ${count}`) }).disabled).toBe(true);
  });

  it('a change to the text after Tick all still closes the preview; opened again, it shows the engine’s ticks', async () => {
    const controller = await opened(SIMPLE_FIXES);
    openPreviewOf(/simple fix/i);
    fireEvent.click(within(preview()!).getByRole('button', { name: /^Tick all/ }));

    act(() => controller.editText(`${SIMPLE_FIXES}\n\nThe road was long.`));
    expect(preview()).toBeNull();
    await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });

    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    expect(boxes()).toEqual(engineTicks(batchDecision(controller, isSimpleFixes)));
    expect(controller.getState().session!.outcomes().filter((o) => o.status === 'applied')).toEqual([]);
  });

  it('is keyboard reachable, and Enter on it ticks instead of applying', async () => {
    const controller = await opened(REVIEW_BATCH);
    openPreviewOf(/recieve/);
    const tickAll = within(preview()!).getByRole<HTMLButtonElement>('button', { name: 'Tick all (2)' });
    expect(tickAll.tabIndex).toBe(0);
    act(() => tickAll.focus());
    // Enter on a focused button does the button's own job, never the review loop's Apply.
    fireEvent.keyDown(tickAll, { key: 'Enter' });
    expect(preview()).not.toBeNull();
    expect(controller.getState().session!.outputText(0)).toBe(REVIEW_BATCH);
  });
});
