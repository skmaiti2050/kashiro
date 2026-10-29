// F23 item 7 (list item 21): a short welcome tour, four tips (the cards, the depth slider, Tick all, the change log),
// shown once after the first document is checked, and replayable from ⋯ › Welcome tour. The test harness marks it
// seen (setup.ts), so other tests never meet it; these tests clear that mark.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);
beforeEach(() => localStorage.removeItem('kashiro.tourSeen'));

const tour = () => screen.queryByRole('dialog', { name: 'Welcome to Kashiro' });
const button = (name: string) => within(tour()!).getByRole('button', { name });

async function openedApp() {
  const { controller } = makeController();
  const app = renderShell(controller);
  return { controller, app };
}

describe('the welcome tour (F23 item 7)', () => {
  it('waits for the first checked document, then shows four tips with Next; Done closes it', async () => {
    const { controller } = await openedApp();
    expect(tour()).toBeNull();
    await openAndWait(controller, () => controller.openText('We was late.'));
    expect(tour()).not.toBeNull();
    expect(tour()!.textContent).toContain('Tip 1 of 4');
    expect(document.activeElement).toBe(button('Next'));
    const tips = [tour()!.querySelector('h3')!.textContent];
    for (let i = 2; i <= 4; i++) {
      fireEvent.click(button('Next'));
      expect(tour()!.textContent).toContain(`Tip ${i} of 4`);
      tips.push(tour()!.querySelector('h3')!.textContent);
    }
    expect(tips).toEqual(['Cards', 'Review depth', 'Tick all', 'The change log']);
    fireEvent.click(button('Done'));
    expect(tour()).toBeNull();
  });

  it('is shown once: not again after a restart or another document', async () => {
    const first = await openedApp();
    await openAndWait(first.controller, () => first.controller.openText('We was late.'));
    fireEvent.click(button('Skip'));
    expect(tour()).toBeNull();
    await openAndWait(first.controller, () => first.controller.openText('They was early.'));
    expect(tour()).toBeNull();
    first.app.unmount();

    const second = await openedApp();
    await openAndWait(second.controller, () => second.controller.openText('We was late.'));
    expect(tour()).toBeNull();
  });

  it('⋯ › Welcome tour replays it from the first tip, also on the start screen', async () => {
    localStorage.setItem('kashiro.tourSeen', 'true');
    await openedApp();
    chooseFromMore('Welcome tour');
    expect(tour()!.textContent).toContain('Tip 1 of 4');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(tour()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
  });
});
