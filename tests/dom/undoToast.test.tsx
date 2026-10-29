// Task F21b item 8 (owner, F21 list item 12): after a big action ("Apply all", a Tick-all apply, rejecting a card's
// places together) a toast says what happened, with an Undo. It is a status message, its Undo is a focusable button,
// and it doesn't time out while focused or hovered. Undo takes back exactly what that action did, through the
// engine's own undo.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionController } from '@/ui/state/sessionController';
import { UndoToast } from '@/ui/UndoToast';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);
afterEach(() => vi.useRealTimers());

const REVIEW_BATCH = 'I recieve mail. You recieve calls.';

async function opened(text: string) {
  const { controller } = makeController({ preset: 'blog' });
  renderShell(controller);
  await openAndWait(controller, () => controller.openText(text));
  return controller;
}

/** Presses J until the current card's title matches `title`. */
function goTo(title: RegExp): void {
  for (let i = 0; i < 20 && !title.test(reviewPanel().querySelector('.card-title')?.textContent ?? ''); i++) fireEvent.keyDown(reviewPanel(), { key: 'j' });
}

const preview = () => reviewPanel().querySelector<HTMLElement>('.batch-preview')!;
const toast = () => document.querySelector<HTMLElement>('.undo-toast');
const pending = (controller: SessionController) =>
  controller
    .getState()
    .session!.outcomes()
    .filter((o) => o.status !== 'pending')
    .map((o) => o.status);

describe('an undo toast after a big action (Task F21b item 8)', () => {
  it('Tick all and Apply: "Applied 2 fixes · Undo"; Undo puts the text and both places back as they were', async () => {
    const controller = await opened(REVIEW_BATCH);
    const decided = controller.getState().decided;
    goTo(/recieve/);
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    fireEvent.click(within(preview()).getByRole('button', { name: 'Tick all (2)' }));
    fireEvent.click(within(preview()).getByRole('button', { name: /^Apply 2/ }));
    expect(controller.getState().session!.outputText(0)).toBe('I receive mail. You receive calls.');

    const shown = toast()!;
    expect(shown.getAttribute('role')).toBe('status');
    expect(shown.textContent).toContain('Applied 2 fixes');
    fireEvent.click(within(shown).getByRole('button', { name: 'Undo' }));

    expect(controller.getState().session!.outputText(0)).toBe(REVIEW_BATCH);
    expect(pending(controller)).toEqual([]);
    expect(controller.getState().decided).toBe(decided);
    expect(toast()).toBeNull();
    expect(reviewPanel().querySelector('.card-title')?.textContent).toMatch(/recieve/);
    // Focus goes to the card that is back, not to the page.
    expect(reviewPanel().contains(document.activeElement)).toBe(true);
  });

  it('rejecting a card’s places together: "Rejected 2 suggestions · Undo"; Undo brings both back to review', async () => {
    const controller = await opened(REVIEW_BATCH);
    const decided = controller.getState().decided;
    goTo(/recieve/);
    fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
    expect(pending(controller)).toEqual(['rejected', 'rejected']);
    expect(toast()!.textContent).toContain('Rejected 2 suggestions');

    fireEvent.click(within(toast()!).getByRole('button', { name: 'Undo' }));
    expect(pending(controller)).toEqual([]);
    expect(controller.getState().decided).toBe(decided);
    expect(toast()).toBeNull();
  });

  it('a decision on one place shows no toast', async () => {
    const controller = await opened('I recieve mail today.');
    goTo(/recieve/);
    fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
    expect(pending(controller)).toEqual(['rejected']);
    expect(toast()).toBeNull();
  });

  it('the next change to the review takes the toast away: its Undo would no longer match', async () => {
    await opened(`${REVIEW_BATCH} I hav a cat.`);
    goTo(/recieve/);
    fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
    expect(toast()).not.toBeNull();
    fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
    expect(toast()).toBeNull();
  });
});

describe('the toast itself (Task F21b item 8)', () => {
  it('goes after a few seconds, but never while focused or hovered', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<UndoToast message="Rejected 600 suggestions" undoLabel="Undo" onUndo={() => {}} onDismiss={onDismiss} />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo.tabIndex).toBe(0);

    act(() => undo.focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => undo.blur());
    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Escape while it has focus dismisses it', () => {
    const onDismiss = vi.fn();
    render(<UndoToast message="Applied 12 fixes" undoLabel="Undo" onUndo={() => {}} onDismiss={onDismiss} />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    act(() => undo.focus());
    fireEvent.keyDown(undo, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
