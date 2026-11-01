// ⋯ › Report a bug (F22 item 4): the report in a dialog, Copy, and GitHub opened only on click. Nothing is sent.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { msg } from '@/ui/i18n/message';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell } from './shell';

const opened = vi.hoisted(() => ({ pages: [] as string[] }));
vi.mock('@/ui/platform/links', () => ({
  openProjectPage: async (page: string) => {
    opened.pages.push(page);
  },
}));
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const SENTENCE = 'Our merger with Acmecorp closes on Friday.';
const NAME = 'Q3-salaries.txt';
const PATH = 'C:\\Users\\Asha\\Documents\\Q3-salaries.txt';

describe('Report a bug', () => {
  it('shows a report without the planted path, name and sentence; opens GitHub only on click; Copy copies it', async () => {
    opened.pages = [];
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText, readText: async () => '' }, configurable: true });
    const { controller } = makeController({ dictionary: ['acmecorp'], modelPath: 'C:\\Users\\Asha\\model.gguf' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openFile({ name: NAME, path: PATH, bytes: new TextEncoder().encode(`${SENTENCE}\n\nWe was late.`) }));
    act(() => controller.showError(msg('error.unsupported', { name: NAME })));
    act(() => controller.showNotice(msg('error.plain', { cause: SENTENCE })));

    chooseFromMore('Report a bug…');
    const dialog = screen.getByRole('dialog', { name: 'Report a bug' });
    const report = within(dialog).getByRole('textbox', { name: 'Report' }) as HTMLTextAreaElement;
    await waitFor(() => expect(report.value).toContain('Version: 1.1.0'));
    expect(report.readOnly).toBe(true);
    expect(report.value).toContain('error.unsupported');
    expect(report.value).toContain('error.plain');
    for (const secret of [PATH, 'Asha', NAME, 'Q3-salaries', SENTENCE, 'Acmecorp', 'acmecorp', 'We was late']) expect(report.value, secret).not.toContain(secret);
    expect(dialog.textContent).toMatch(/Nothing is sent/);
    expect(opened.pages).toEqual([]);

    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' })));
    expect(writeText).toHaveBeenCalledWith(report.value);
    expect(within(dialog).getByRole('status').textContent).toBe('Copied.');
    expect(opened.pages).toEqual([]);

    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Open GitHub issues' })));
    expect(opened.pages).toEqual(['issues']);
  });
});
