import { describe, it, expect, beforeAll } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionController } from '@/ui/state/sessionController';
import { makeController, Panel, warmLinter } from './harness';

beforeAll(warmLinter);

/** Presses J in the panel until the card matching `selector` is the current one. */
function showCard(selector: string): HTMLElement {
  const panel = screen.getByRole('complementary', { name: 'Review' });
  for (let i = 0; i < 20; i++) {
    const card = panel.querySelector<HTMLElement>(selector);
    if (card) return card;
    fireEvent.keyDown(panel, { key: 'j' });
  }
  throw new Error(`No ${selector} card`);
}

/** Types `text` into the document and waits for its re-check to finish. */
async function retype(controller: SessionController, text: string) {
  act(() => controller.editText(text));
  await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });
}

const box = (card: HTMLElement, word: string) => within(card).getByRole<HTMLInputElement>('checkbox', { name: new RegExp(`^${word}`) });
const tick = (card: HTMLElement, word: string) => fireEvent.click(box(card, word));

describe('word-list cards keep the user’s ticks across a re-check', () => {
  it('names card: an unticked name stays unticked, and Add sends it as a typo', async () => {
    const { controller, saved } = makeController();
    const text = 'We met Anjali Kulkarni in Nashik today.';
    await controller.openText(text);
    render(<Panel controller={controller} />);
    tick(showCard('.card.names'), 'Nashik');

    await retype(controller, `${text}\n\nThe road was long.`);
    const card = showCard('.card.names');
    expect(box(card, 'Nashik').checked).toBe(false);
    fireEvent.click(within(card).getByRole('button', { name: /Add 2 to my dictionary/ }));

    await waitFor(() => expect(saved.at(-1)?.dictionary).toEqual(['Anjali', 'Kulkarni']));
  });

  it('terms card: an unticked term stays unticked after the re-check', async () => {
    const { controller, saved } = makeController();
    const text =
      'Each plasmodium has a role. The plasmodium shifts with the season, and a plasmodium can rise. ' +
      'The ferrocement wall, the ferrocement lid and the ferrocement tank stay cool.';
    await controller.openText(text);
    render(<Panel controller={controller} />);
    tick(showCard('.card.terms'), 'ferrocement');

    await retype(controller, `${text}\n\nThe road was long.`);
    const card = showCard('.card.terms');
    expect(box(card, 'ferrocement').checked).toBe(false);
    fireEvent.click(within(card).getByRole('button', { name: /Add 1 to my dictionary/ }));

    await waitFor(() => expect(saved.at(-1)?.dictionary).toEqual(['plasmodium']));
  });

  it('Indian-language card: a likely typo ticked explicitly stays ticked and is added', async () => {
    const { controller, saved } = makeController();
    const text = 'He said chalo, and we will jion the bhalo party.';
    await controller.openText(text);
    render(<Panel controller={controller} />);
    const before = showCard('.card.other-language');
    expect(box(before, 'jion').checked).toBe(false);
    tick(before, 'jion');

    await retype(controller, `${text}\n\nThe road was long.`);
    const card = showCard('.card.other-language');
    expect(box(card, 'jion').checked).toBe(true);
    fireEvent.click(within(card).getByRole('button', { name: /Add all to my dictionary/ }));

    await waitFor(() => expect(saved.at(-1)?.dictionary).toEqual(['chalo', 'jion', 'bhalo']));
  });
});
