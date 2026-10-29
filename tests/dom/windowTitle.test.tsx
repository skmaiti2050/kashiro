/**
 * Task F20 item 11 (owner): an opened file names the window, "{name} — Kashiro", its name cut in the middle when long
 * (the start and the extension kept); a pasted or sample document keeps "Kashiro". The toolbar shows the file's name,
 * with the full name as its title. Task F21 item B (owner): the separator is a plain hyphen, "{name} - Kashiro".
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { middleTruncate, windowTitle } from '@/ui/state/windowTitle';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell } from './shell';

const setTitle = vi.fn(async (_title: string) => {});
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, destroy: async () => {}, setTitle }),
}));
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);
beforeEach(() => setTitle.mockClear());

const LONG = 'Disaster-Recovery-Runbook-for-the-Mumbai-Region-Primary-Cluster-v2.docx';

describe('the window title text', () => {
  it('a file: its name and the app; a paste, the sample or nothing: the app alone', () => {
    expect(windowTitle({ name: 'runbook.md', path: 'C:/docs/runbook.md' })).toBe('runbook.md - Kashiro');
    expect(windowTitle({ name: 'Untitled.txt', path: null })).toBe('Kashiro');
    expect(windowTitle(null)).toBe('Kashiro');
  });

  it('unsaved changes put a dot before the name (Task F21b item 7)', () => {
    expect(windowTitle({ name: 'runbook.md', path: 'C:/docs/runbook.md' }, true)).toBe('● runbook.md - Kashiro');
    expect(windowTitle({ name: 'runbook.md', path: 'C:/docs/runbook.md' }, false)).toBe('runbook.md - Kashiro');
    expect(windowTitle({ name: 'Untitled.txt', path: null }, true)).toBe('● Kashiro');
  });

  it('a long name is cut in the middle to 48 characters, keeping its start and its extension', () => {
    const cut = middleTruncate(LONG);
    expect([...cut]).toHaveLength(48);
    expect(cut.startsWith('Disaster-Recovery-Run')).toBe(true);
    expect(cut.endsWith('-v2.docx')).toBe(true);
    expect(cut).toContain('…');
    expect(windowTitle({ name: LONG, path: `C:/docs/${LONG}` })).toBe(`${cut} - Kashiro`);
    expect(middleTruncate('short.docx')).toBe('short.docx');
  });

  it('never cuts a character in two', () => {
    const name = `${'क्ष'.repeat(30)}.txt`;
    const cut = middleTruncate(name);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(cut.endsWith('.txt')).toBe(true);
  });
});

describe('the window title follows the open document (Task F20 item 11)', () => {
  it('an opened file sets "{name} - Kashiro"; a paste goes back to "Kashiro"', async () => {
    const { controller } = makeController();
    renderShell(controller);
    const name = LONG.replace('.docx', '.md');
    await openAndWait(controller, () => controller.openFile({ name, path: `C:/docs/${name}`, bytes: new TextEncoder().encode('The cat sat on the mat.') }));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith(`${middleTruncate(name)} - Kashiro`));
    expect(middleTruncate(name).endsWith('-v2.md')).toBe(true);
    const label = within(screen.getByRole('toolbar')).getByText(middleTruncate(name));
    expect(label.getAttribute('title')).toBe(name);

    await openAndWait(controller, () => controller.openText('Pasted words here.'));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith('Kashiro'));
    expect(screen.getByRole('toolbar').querySelector('.doc-name')).toBeNull();
  });

  it('an applied change that is not saved yet shows "● name - Kashiro" (Task F21b item 7)', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openFile({ name: 'notes.md', path: 'C:/docs/notes.md', bytes: new TextEncoder().encode('I recieve the letter today.') }));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith('notes.md - Kashiro'));
    const decision = controller.getState().session!.decisions().top[0];
    act(() => controller.accept(decision.id));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith('● notes.md - Kashiro'));
  });

  it('saving takes the dot away at once (Task F21b item 7)', async () => {
    const files = { open: async () => null, save: async (path: string) => ({ path, backup: null }) };
    const { controller } = makeController({}, files);
    renderShell(controller);
    await openAndWait(controller, () => controller.openFile({ name: 'notes.md', path: 'C:/docs/notes.md', bytes: new TextEncoder().encode('I recieve the letter today.') }));
    act(() => controller.accept(controller.getState().session!.decisions().top[0].id));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith('● notes.md - Kashiro'));
    await act(async () => void (await controller.save()));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith('notes.md - Kashiro'));
  });

  it('the sample keeps "Kashiro"', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await act(async () => {});
    await openAndWait(controller, () => controller.openSample());
    expect(setTitle.mock.calls.every(([title]) => title === 'Kashiro')).toBe(true);
  });
});
