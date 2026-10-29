// F23 item 2 (list item 23): the category counts at the top of the review panel work as filters. A filter only narrows
// the card list (and J / K and the counts with it); it never changes a card, its members or its ticks.
import { describe, it, expect, beforeAll } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionController } from '@/ui/state/sessionController';
import { makeController, Panel, warmLinter } from './harness';
import { reviewPanel } from './shell';

beforeAll(warmLinter);

// Correctness 4 (the simple-fixes card, two spellings, a repetition) and Clarity 2 (could of, very unique).
const TEXT = 'It was the the end. We could of finished it sooner. Each farmer should recieve water. This is very unique. He dont know. The data is really really important.';

async function opened(): Promise<SessionController> {
  const { controller } = makeController({ preset: 'blog' });
  await controller.openText(TEXT);
  render(<Panel controller={controller} />);
  return controller;
}

const filters = () => within(screen.getByRole('group', { name: 'Filter by category' }));
const slot = () => screen.getByRole('group', { name: /^Card \d+ of \d+ left\. / });
const shownCategory = () => slot().querySelector('.category')?.textContent ?? '';
const pressJ = () => fireEvent.keyDown(reviewPanel(), { key: 'j' });

describe('category counts that work as filters (F23 item 2)', () => {
  it('shows each category with its count as a toggle button', async () => {
    await opened();
    const correctness = filters().getByRole('button', { name: 'Correctness 4' });
    const clarity = filters().getByRole('button', { name: 'Clarity 2' });
    expect(correctness.getAttribute('aria-pressed')).toBe('false');
    expect(clarity.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows only the chosen category; J and K stay inside it and the count follows; a second click clears it', async () => {
    await opened();
    expect(slot().getAttribute('aria-label')).toMatch(/^Card 1 of 6 left\./);

    fireEvent.click(filters().getByRole('button', { name: 'Clarity 2' }));
    expect(filters().getByRole('button', { name: 'Clarity 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(slot().getAttribute('aria-label')).toMatch(/^Card \d of 2 left\./);
    const titles = new Set<string>();
    for (let i = 0; i < 4; i++) {
      expect(shownCategory()).toContain('Clarity');
      titles.add(slot().querySelector('.card-title')!.textContent!);
      pressJ();
    }
    expect(titles.size).toBe(2);
    fireEvent.keyDown(reviewPanel(), { key: 'k' });
    expect(shownCategory()).toContain('Clarity');

    fireEvent.click(filters().getByRole('button', { name: 'Clarity 2' }));
    expect(filters().getByRole('button', { name: 'Clarity 2' }).getAttribute('aria-pressed')).toBe('false');
    expect(slot().getAttribute('aria-label')).toMatch(/of 6 left\./);
  });

  it('never changes the cards, the simple-fixes members or their ticks', async () => {
    const controller = await opened();
    const before = JSON.stringify(controller.getState().session!.decisions());
    fireEvent.click(filters().getByRole('button', { name: 'Correctness 4' }));
    for (let i = 0; i < 4 && !/simple fix/.test(slot().textContent!); i++) pressJ();
    expect(slot().textContent).toMatch(/1 simple fix: review and apply/);
    fireEvent.click(filters().getByRole('button', { name: 'Correctness 4' }));
    expect(JSON.stringify(controller.getState().session!.decisions())).toBe(before);
  });

  it('clears itself when the last card of the chosen category is decided', async () => {
    await opened();
    fireEvent.click(filters().getByRole('button', { name: 'Clarity 2' }));
    fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
    expect(filters().getByRole('button', { name: 'Clarity 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(shownCategory()).toContain('Clarity');
    fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
    expect(filters().queryByRole('button', { name: /^Clarity/ })).toBeNull();
    expect(filters().getByRole('button', { name: 'Correctness 4' }).getAttribute('aria-pressed')).toBe('false');
    expect(shownCategory()).toContain('Correctness');
  });
});
