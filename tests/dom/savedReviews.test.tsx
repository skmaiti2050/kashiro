// Saved review sessions (Task S3) in the app shell: the resume prompt, the Recent reviews list and Settings.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { Files, OpenedFile, SessionController } from '@/ui/state/sessionController';
import { memorySessionFiles } from '../fixtures/memorySessionFiles';
import { makeController, noFiles, warmLinter } from './harness';
import { openAndWait, renderShell } from './shell';

/** The window's close-requested handler, as App registers it. */
const closeWindow = vi.hoisted(() => ({ handler: null as ((event: { preventDefault(): void }) => Promise<void>) | null }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: (event: { preventDefault(): void }) => Promise<void>) => {
      closeWindow.handler = handler;
      return () => {};
    },
    destroy: async () => {},
  }),
}));
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const FILE: OpenedFile = {
  name: 'note.txt',
  path: '/docs/note.txt',
  bytes: new TextEncoder().encode('I think teh cat is here.\n\nShe recieved the letter.\n\nWe was late again.'),
};
const filesOpening = (file: OpenedFile): Files => ({ ...noFiles, open: async () => file });

/** The first run: FILE reviewed with two decisions, saved to `disk`. */
async function reviewedOn(disk: ReturnType<typeof memorySessionFiles>) {
  const { controller } = makeController({}, noFiles, disk.files);
  await controller.openFile(FILE);
  const session = controller.getState().session!;
  const idOf = (original: string) => session.candidates().find((c) => c.original === original)!.id;
  controller.accept(idOf('recieved'));
  controller.reject(idOf('was'));
  await controller.reviews.flush();
  return controller.getState().session!.rankedDecisionCount();
}

const announced = () => document.querySelector('[role="status"][aria-atomic="true"]')!.textContent;

async function reopen(controller: SessionController) {
  renderShell(controller);
  await openAndWait(controller, () => controller.openFile(FILE));
  await waitFor(() => expect(controller.getState().resumeOffer).not.toBeNull());
}

describe('resume prompt', () => {
  it('asks "Resume your review?" with the counts, focused on Resume; Resume restores and announces', async () => {
    const disk = memorySessionFiles();
    const left = await reviewedOn(disk);
    const { controller } = makeController({}, noFiles, disk.files);
    await reopen(controller);
    const dialog = screen.getByRole('alertdialog', { name: 'Resume your review?' });
    expect(dialog.textContent).toContain(`2 decisions made, ${left} left.`);
    const resume = within(dialog).getByRole('button', { name: 'Resume' });
    expect(document.activeElement).toBe(resume);
    await act(async () => fireEvent.click(resume));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // The prompt closes at once; the restore (a full check) announces when it is done, later under load.
    await waitFor(() => expect(announced()).toBe('Review resumed: 2 decisions restored, 0 paragraphs re-checked.'));
  });

  it('Start fresh closes it and forgets the saved review', async () => {
    const disk = memorySessionFiles();
    await reviewedOn(disk);
    const { controller } = makeController({}, noFiles, disk.files);
    await reopen(controller);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start fresh' })));
    await waitFor(() => expect(disk.stored.size).toBe(0));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Escape closes it and keeps the saved review', async () => {
    const disk = memorySessionFiles();
    await reviewedOn(disk);
    const { controller } = makeController({}, noFiles, disk.files);
    await reopen(controller);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(disk.stored.size).toBe(1);
  });

  it('a changed file says so', async () => {
    const disk = memorySessionFiles();
    await reviewedOn(disk);
    const { controller } = makeController({}, noFiles, disk.files);
    renderShell(controller);
    const changed = { ...FILE, bytes: new TextEncoder().encode('I think teh cat is here.\n\nShe recieved a letter.') };
    await openAndWait(controller, () => controller.openFile(changed));
    await waitFor(() => expect(screen.getByRole('alertdialog', { name: 'This file changed since your last review' })).toBeTruthy());
    expect(screen.getByRole('alertdialog').textContent).toContain('Resume where possible?');
  });
});

describe('Recent reviews', () => {
  it('lists saved reviews on the start screen as buttons; one opens its file and resumes', async () => {
    const disk = memorySessionFiles();
    await reviewedOn(disk);
    const { controller } = makeController({}, filesOpening(FILE), disk.files);
    renderShell(controller);
    await act(() => controller.reviews.startUp());
    const list = screen.getByRole('region', { name: 'Recent reviews' });
    const row = within(list).getByRole('button', { name: /note\.txt/ });
    expect(row.textContent).toContain('/docs/note.txt');
    expect(row.textContent).toContain('2 decisions made');
    row.focus();
    expect(document.activeElement).toBe(row);
    await act(async () => fireEvent.click(row));
    await waitFor(() => expect(controller.getState().phase).toBe('ready'));
    await waitFor(() => expect(announced()).toMatch(/^Review resumed/));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is not shown with the Saved reviews switch off', async () => {
    const disk = memorySessionFiles();
    await reviewedOn(disk);
    const { controller } = makeController({ modules: { ...DEFAULT_MODULES, savedSessions: false } }, noFiles, disk.files);
    renderShell(controller);
    await act(() => controller.reviews.startUp());
    expect(screen.queryByRole('region', { name: 'Recent reviews' })).toBeNull();
  });
});

describe('Settings', () => {
  it('Saved reviews: the module switch, keep pasted text, retention and Delete all', async () => {
    const disk = memorySessionFiles();
    await reviewedOn(disk);
    const { controller, saved } = makeController({}, noFiles, disk.files);
    renderShell(controller);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('switch', { name: /Saved reviews/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep pasted text for resuming' }));
    await waitFor(() => expect(saved.at(-1)!.keepPastedText).toBe(true));
    fireEvent.change(screen.getByRole('combobox', { name: 'Keep saved reviews for' }), { target: { value: '7' } });
    await waitFor(() => expect(saved.at(-1)!.sessionRetentionDays).toBe(7));
    // Asked first; Cancel keeps them.
    fireEvent.click(screen.getByRole('button', { name: 'Delete all saved reviews' }));
    const ask = screen.getByRole('alertdialog', { name: 'Delete all saved reviews?' });
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(disk.stored.size).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete all saved reviews' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete all' })));
    await waitFor(() => expect(disk.stored.size).toBe(0));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(announced()).toBe('Saved reviews deleted.'));
  });
});

describe('closing the window', () => {
  it('a failed autosave keeps the window open and shows why', async () => {
    const disk = memorySessionFiles();
    disk.files.save = async () => {
      throw new Error('disk full');
    };
    const { controller } = makeController({}, noFiles, disk.files);
    renderShell(controller);
    await openAndWait(controller, () => controller.openFile(FILE));
    const session = controller.getState().session!;
    act(() => controller.accept(session.candidates().find((c) => c.original === 'recieved')!.id));
    await waitFor(() => expect(closeWindow.handler).not.toBeNull());
    const event = { prevented: false, preventDefault() {
      this.prevented = true;
    } };
    await act(() => closeWindow.handler!(event));
    expect(event.prevented).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('disk full');
  });
});
