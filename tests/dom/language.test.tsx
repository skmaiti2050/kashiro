// Interface language (Task L1): switching at runtime, the page's lang, and axe in Hindi.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import axe from 'axe-core';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

async function seriousViolations(): Promise<string[]> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  const results = await axe.run(document.body, { resultTypes: ['violations'] });
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
}

describe('app language', () => {
  it('switching to Hindi in Settings updates the whole UI at once, without a restart, and is saved', async () => {
    const { controller, saved } = makeController();
    const { container } = renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'App language' }), { target: { value: 'hi' } });

    expect(screen.getByRole('dialog', { name: 'सेटिंग्स' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'खोलें' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'समीक्षा' })).toBeTruthy();
    expect(container.querySelector('.app')!.getAttribute('lang')).toBe('hi');
    expect(document.documentElement.lang).toBe('hi');
    expect(document.documentElement.dir).toBe('ltr');
    expect(saved.at(-1)!.uiLanguage).toBe('hi');

    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'ऐप की भाषा' }), { target: { value: 'en' } });
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('switching to Bengali at runtime updates the UI and the page language', async () => {
    const { controller, saved } = makeController();
    const { container } = renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'App language' }), { target: { value: 'bn' } });

    expect(screen.getByRole('dialog', { name: 'সেটিংস' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'খুলুন' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'রিভিউ' })).toBeTruthy();
    expect(container.querySelector('.app')!.getAttribute('lang')).toBe('bn');
    expect(document.documentElement.lang).toBe('bn');
    expect(saved.at(-1)!.uiLanguage).toBe('bn');
    // The document stays English, left to right, whatever the UI language and its direction.
    const text = container.querySelector('.cm-content')!;
    expect(text.getAttribute('lang')).toBe('en');
    expect(text.getAttribute('dir')).toBe('ltr');
  });

  it.each([
    { language: 'hi' as const, settings: 'सेटिंग्स', close: 'बंद करें', shortcuts: 'शॉर्टकट' },
    { language: 'bn' as const, settings: 'সেটিংস', close: 'বন্ধ করুন', shortcuts: 'শর্টকাট' },
  ])('axe: no serious or critical violations in $language (review panel, Settings, shortcuts)', async ({ language, settings, close, shortcuts }) => {
    const { controller } = makeController({ uiLanguage: language });
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    expect(await seriousViolations()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: settings }));
    expect(await seriousViolations()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: close }));
    fireEvent.click(screen.getByRole('button', { name: shortcuts }));
    expect(await seriousViolations()).toEqual([]);
  });
});
