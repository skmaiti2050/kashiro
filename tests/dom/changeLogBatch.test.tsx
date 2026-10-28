/**
 * Task F20 item 2 (owner: "Expandable row, Undo per line"): a batch row of 214 changes was one wrapped block with
 * "Undo all" centred beside it. It is now a header with "Show N changes" and "Undo all N" at its top right,
 * collapsed by default; opened, it lists one change per line, each with its own Undo, in a list that scrolls.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CheckSession, Outcome } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import { ChangeLog } from '@/ui/ChangeLog';
import { createTranslator } from '@/ui/i18n/translator';
import { TranslatorProvider } from '@/ui/i18n/useT';
import type { ControllerState, SessionController } from '@/ui/state/sessionController';

const TEXT = 'I think teh plan works. The cat of of mine ate a apple today.';

const applied = (id: string, original: string, replacement: string, kind: string, paragraphNumber = 1, at = TEXT.indexOf(original)): Outcome => {
  const candidate: Candidate = { id, paraId: 0, span: { start: at, end: at + original.length }, original, replacements: [replacement], kind, message: '', source: 'rules' };
  return { candidate, paragraphNumber, status: 'applied', auto: false, replacement, batch: 'batch-1' };
};

const CARD = [applied('t', 'teh', 'the', 'Typo', 1), applied('o', 'of of', 'of', 'Repetition', 2), applied('a', 'a', 'an', 'Miscellaneous', 226, TEXT.indexOf(' a apple') + 1)];

function view(outcomes: Outcome[], controller: Partial<SessionController> = {}) {
  const session = { outcomes: () => outcomes, paragraphs: () => [{ id: 0, text: TEXT }] } as unknown as CheckSession;
  const tree = (list: Outcome[]) => (
    <TranslatorProvider translator={createTranslator('en', ['en-IN'])}>
      <ChangeLog controller={controller as SessionController} state={{ session: { ...session, outcomes: () => list } } as unknown as ControllerState} open onToggle={() => {}} />
    </TranslatorProvider>
  );
  const result = render(tree(outcomes));
  return { ...result, update: (list: Outcome[]) => result.rerender(tree(list)) };
}

const batchRow = (container: HTMLElement) => container.querySelector<HTMLElement>('li.batch')!;
const toggle = (container: HTMLElement) => within(batchRow(container)).getByRole('button', { name: /changes/ });

describe('ChangeLog: the batch row opens to one change per line (Task F20 item 2)', () => {
  it('is collapsed by default: a header with "Show N changes" and "Undo all N", and no list', () => {
    const { container } = view(CARD);
    const row = batchRow(container);
    expect(within(row).getByText('3 fixes (Typos, Repeated words, Other) applied together')).toBeTruthy();
    const button = toggle(container);
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toBe('Show 3 changes ▾');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(within(row).getByRole('button', { name: 'Undo all 3' })).toBeTruthy();
    expect(row.querySelectorAll('.change')).toHaveLength(0);
  });

  it('the toggle opens and closes the list, and says which', () => {
    const { container } = view(CARD);
    fireEvent.click(toggle(container));
    expect(toggle(container).textContent).toBe('Hide changes ▴');
    expect(toggle(container).getAttribute('aria-expanded')).toBe('true');
    const list = document.getElementById(toggle(container).getAttribute('aria-controls')!)!;
    expect(list).toBeTruthy();
    const lines = [...list.querySelectorAll(':scope > li')];
    expect(lines.map((li) => `${li.querySelector('.where')!.textContent} | ${li.querySelector('del')!.textContent} → ${li.querySelector('ins')!.textContent} | ${li.querySelector('button')!.textContent}`)).toEqual([
      'P 1 | teh → the | Undo',
      'P 2 | of of → of | Undo',
      'P 226 | a → an | Undo',
    ]);
    fireEvent.click(toggle(container));
    expect(toggle(container).textContent).toBe('Show 3 changes ▾');
    expect(batchRow(container).querySelectorAll('.change')).toHaveLength(0);
  });

  it("a line's Undo undoes only that change; the header count follows", () => {
    const undo = vi.fn();
    const { container, update } = view(CARD, { undo });
    fireEvent.click(toggle(container));
    const second = batchRow(container).querySelectorAll('.batch-changes > li')[1];
    fireEvent.click(within(second as HTMLElement).getByRole('button', { name: 'Undo' }));
    expect(undo.mock.calls).toEqual([['o']]);
    // The engine takes the undone change out of the batch (it becomes its own "undone" row).
    update([CARD[0], { ...CARD[1], status: 'rejected', reason: 'undone', batch: undefined }, CARD[2]]);
    const row = batchRow(container);
    expect(within(row).getByText('2 fixes (Typos, Other) applied together')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Undo all 2' })).toBeTruthy();
    expect(toggle(container).getAttribute('aria-expanded')).toBe('true');
    expect(row.querySelectorAll('.batch-changes > li')).toHaveLength(2);
  });

  it('"Undo all" still undoes the whole batch', () => {
    const undoBatch = vi.fn();
    const { container } = view(CARD, { undoBatch });
    fireEvent.click(within(batchRow(container)).getByRole('button', { name: 'Undo all 3' }));
    expect(undoBatch.mock.calls).toEqual([['batch-1']]);
  });
});

describe('ChangeLog rows sit at the top, and the open list scrolls inside the log (Task F20 item 2)', () => {
  // jsdom has no layout, so the check is on the app's real CSS.
  const style = document.createElement('style');
  beforeAll(() => {
    style.textContent = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
    document.head.append(style);
  });
  afterAll(() => style.remove());

  it('every row, single or batch, and the batch header align to the top', () => {
    const { container } = view([...CARD, { ...applied('s', 'plan', 'plan', 'Spelling'), batch: undefined }]);
    fireEvent.click(toggle(container));
    const single = [...container.querySelectorAll<HTMLElement>('.entries > li')].find((li) => !li.classList.contains('batch'))!;
    expect(getComputedStyle(single).alignItems).toBe('start');
    expect(getComputedStyle(container.querySelector('.batch-head')!).alignItems).toBe('start');
    for (const line of container.querySelectorAll('.batch-changes > li')) expect(getComputedStyle(line).alignItems).toBe('start');
  });

  it('the open list has a height cap and scrolls, positioned (F19)', () => {
    const { container } = view(CARD);
    fireEvent.click(toggle(container));
    const list = getComputedStyle(container.querySelector('.batch-changes')!);
    expect(list.maxHeight).toMatch(/em$/);
    expect(list.overflowY).toBe('auto');
    expect(list.position).toBe('relative');
  });

  it('"Show N changes" and "Undo all N" stay together at the end of the header', () => {
    const { container } = view(CARD);
    const actions = container.querySelector('.batch-head .batch-actions')!;
    expect([...actions.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Show 3 changes ▾', 'Undo all 3']);
  });

  it('opens in Hindi and Bengali too', () => {
    for (const language of ['hi', 'bn'] as const) {
      const session = { outcomes: () => CARD, paragraphs: () => [{ id: 0, text: TEXT }] } as unknown as CheckSession;
      const { container, unmount } = render(
        <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
          <ChangeLog controller={{} as SessionController} state={{ session } as ControllerState} open onToggle={() => {}} />
        </TranslatorProvider>,
      );
      const button = container.querySelector<HTMLButtonElement>('.batch-toggle')!;
      expect(button.textContent).not.toMatch(/Show|Hide/);
      fireEvent.click(button);
      expect(button.textContent).not.toMatch(/Show|Hide/);
      expect(container.querySelectorAll('.batch-changes > li')).toHaveLength(3);
      unmount();
    }
  });
});

describe('ChangeLog: a change\'s place reads "P 226", and "Paragraph 226" on hover and to screen readers (Task F20 item 3)', () => {
  it.each([
    ['en', 'P 226', 'Paragraph 226'],
    ['hi', 'अनु. 226', 'अनुच्छेद 226'],
    ['bn', 'অনু. 226', 'অনুচ্ছেদ 226'],
  ] as const)('%s, on a single row and on each line of a batch', (language, shown, full) => {
    const single = { ...applied('s', 'plan', 'plan', 'Spelling', 226), batch: undefined };
    const session = { outcomes: () => [single, CARD[2]], paragraphs: () => [{ id: 0, text: TEXT }] } as unknown as CheckSession;
    const { container } = render(
      <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
        <ChangeLog controller={{} as SessionController} state={{ session } as ControllerState} open onToggle={() => {}} />
      </TranslatorProvider>,
    );
    fireEvent.click(container.querySelector('.batch-toggle')!);
    const places = [...container.querySelectorAll('.where')];
    expect(places).toHaveLength(2);
    for (const place of places) {
      expect(place.textContent).toBe(shown);
      expect(place.getAttribute('title')).toBe(full);
      expect(place.getAttribute('aria-label')).toBe(full);
    }
    expect(container.textContent).not.toContain('¶');
  });
});

describe('ChangeLog: the expanded row has no accessibility violations', () => {
  it('passes axe', async () => {
    const axe = (await import('axe-core')).default;
    const { container } = view(CARD, {});
    fireEvent.click(toggle(container));
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(3);
  });
});
