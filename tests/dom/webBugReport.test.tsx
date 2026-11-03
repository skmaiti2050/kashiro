// Web Task 4: ⋯ › Report a bug with the web's environment: the report names the browser instead of Windows and
// WebView2, and still holds none of the planted path, file name, sentence or dictionary word.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { msg } from '@/ui/i18n/message';
import type { Capabilities } from '@/ui/platform/capabilities';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell } from './shell';

const platform = vi.hoisted(() => ({
  capabilities: { ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'download', web: true } satisfies Capabilities,
}));
vi.mock('@/ui/platform/capabilities', () => platform);
vi.mock('@/ui/platform/environment', () => import('@/ui/platform-web/environment'));
vi.mock('@/ui/platform/links', () => import('@/ui/platform-web/links'));
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);
afterEach(() => {
  Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true });
});

const SENTENCE = 'Our merger with Acmecorp closes on Friday.';
const NAME = 'Q3-salaries.txt';
const PATH = 'C:\\Users\\Asha\\Documents\\Q3-salaries.txt';

describe('Report a bug on the web', () => {
  it('names the browser, not Windows or WebView2, and leaves out the planted path, name and sentence', async () => {
    Object.defineProperty(navigator, 'userAgentData', {
      value: { brands: [{ brand: 'Microsoft Edge', version: '130' }, { brand: 'Chromium', version: '130' }] },
      configurable: true,
    });
    const { controller } = makeController({ dictionary: ['acmecorp'] });
    renderShell(controller);
    await openAndWait(controller, () => controller.openFile({ name: NAME, path: PATH, bytes: new TextEncoder().encode(`${SENTENCE}\n\nWe was late.`) }));
    act(() => controller.showError(msg('error.unsupported', { name: NAME })));
    act(() => controller.showNotice(msg('error.plain', { cause: SENTENCE })));

    chooseFromMore('Report a bug…');
    const dialog = screen.getByRole('dialog', { name: 'Report a bug' });
    const report = within(dialog).getByRole('textbox', { name: 'Report' }) as HTMLTextAreaElement;
    await waitFor(() => expect(report.value).toContain('Version: 1.3.1'));
    expect(report.value).toContain('Browser: Microsoft Edge 130');
    expect(report.value).not.toContain('Windows');
    expect(report.value).not.toContain('WebView2');
    expect(report.value).toContain('error.unsupported');
    for (const secret of [PATH, 'Asha', NAME, 'Q3-salaries', SENTENCE, 'Acmecorp', 'acmecorp', 'We was late']) expect(report.value, secret).not.toContain(secret);
  });
});
