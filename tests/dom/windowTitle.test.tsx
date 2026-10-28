/**
 * Task F20 item 11 (owner): an opened file names the window, "{name} — Kashiro", its name cut in the middle when long
 * (the start and the extension kept); a pasted or sample document keeps "Kashiro". The toolbar shows the file's name,
 * with the full name as its title.
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
    expect(windowTitle({ name: 'runbook.md', path: 'C:/docs/runbook.md' })).toBe('runbook.md — Kashiro');
    expect(windowTitle({ name: 'Untitled.txt', path: null })).toBe('Kashiro');
    expect(windowTitle(null)).toBe('Kashiro');
  });

  it('a long name is cut in the middle to 48 characters, keeping its start and its extension', () => {
    const cut = middleTruncate(LONG);
    expect([...cut]).toHaveLength(48);
    expect(cut.startsWith('Disaster-Recovery-Run')).toBe(true);
    expect(cut.endsWith('-v2.docx')).toBe(true);
    expect(cut).toContain('…');
    expect(windowTitle({ name: LONG, path: `C:/docs/${LONG}` })).toBe(`${cut} — Kashiro`);
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
  it('an opened file sets "{name} — Kashiro"; a paste goes back to "Kashiro"', async () => {
    const { controller } = makeController();
    renderShell(controller);
    const name = LONG.replace('.docx', '.md');
    await openAndWait(controller, () => controller.openFile({ name, path: `C:/docs/${name}`, bytes: new TextEncoder().encode('The cat sat on the mat.') }));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith(`${middleTruncate(name)} — Kashiro`));
    expect(middleTruncate(name).endsWith('-v2.md')).toBe(true);
    const label = within(screen.getByRole('toolbar')).getByText(middleTruncate(name));
    expect(label.getAttribute('title')).toBe(name);

    await openAndWait(controller, () => controller.openText('Pasted words here.'));
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith('Kashiro'));
    expect(screen.getByRole('toolbar').querySelector('.doc-name')).toBeNull();
  });

  it('the sample keeps "Kashiro"', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await act(async () => {});
    await openAndWait(controller, () => controller.openSample());
    expect(setTitle.mock.calls.every(([title]) => title === 'Kashiro')).toBe(true);
  });
});
