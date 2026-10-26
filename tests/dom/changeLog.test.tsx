import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CheckSession, Outcome } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import { ChangeLog } from '@/ui/ChangeLog';
import { createTranslator } from '@/ui/i18n/translator';
import { TranslatorProvider } from '@/ui/i18n/useT';
import type { ControllerState, SessionController } from '@/ui/state/sessionController';

const TEXT = 'I think teh plan works. The cat of of mine ate a apple today.';

/** A change "apply all" made to the first `original` in `text` (or the one at `at`). */
const applied = (id: string, original: string, replacement: string, kind: string, text = TEXT, at = text.indexOf(original)): Outcome => {
  const candidate: Candidate = { id, paraId: 0, span: { start: at, end: at + original.length }, original, replacements: [replacement], kind, message: '', source: 'rules' };
  return { candidate, paragraphNumber: 1, status: 'applied', auto: false, replacement, batch: 'batch-1' };
};

function renderLog(outcomes: Outcome[], text = TEXT, language: 'en' | 'hi' | 'bn' = 'en') {
  const session = { outcomes: () => outcomes, paragraphs: () => [{ id: 0, text }] } as unknown as CheckSession;
  return render(
    <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
      <ChangeLog controller={{} as SessionController} state={{ session } as ControllerState} open onToggle={() => {}} />
    </TranslatorProvider>,
  );
}

const CARD = [applied('t', 'teh', 'the', 'Typo'), applied('o', 'of of', 'of', 'Repetition'), applied('a', 'a', 'an', 'Miscellaneous', TEXT, TEXT.indexOf(' a apple') + 1)];

describe('ChangeLog: one row for the simple-fixes card (Task F4)', () => {
  it('names every kind the card applied, not only the first', () => {
    renderLog(CARD);
    expect(screen.getByText('3 fixes (Typos, Repeated words, Other) applied together')).toBeTruthy();
  });

  it('lists every change the card made, not only the first (F4 re-review 3, M-7)', () => {
    const { container } = renderLog(CARD);
    const changes = [...container.querySelectorAll('li.batch .change')].map((c) => `${c.querySelector('del')!.textContent} → ${c.querySelector('ins')!.textContent}`);
    expect(changes).toEqual(['teh → the', 'of of → of', 'a → an']);
  });

  it('shows each change with a few words around it, cut at whole words (F5 re-review 4, M-6)', () => {
    const { container } = renderLog(CARD);
    const changes = [...container.querySelectorAll('li.batch .change')].map((c) => c.textContent);
    expect(changes).toEqual(['I think teh → the plan works.…', '…The cat of of → of mine ate a…', '…of mine ate a → an apple…']);
  });

  it('draws a spacing change instead of leaving it blank, and says it to screen readers', () => {
    const text = 'We went  home today.';
    const { container } = renderLog([applied('s', '  ', ' ', 'Formatting', text)], text);
    const [del, ins] = [container.querySelector('.change del')!, container.querySelector('.change ins')!];
    expect(del.querySelector('[aria-hidden="true"]')!.textContent).toBe('··');
    expect(ins.querySelector('[aria-hidden="true"]')!.textContent).toBe('·');
    expect(del.querySelector('.visually-hidden')!.textContent).toBe('2 spaces');
    expect(ins.querySelector('.visually-hidden')!.textContent).toBe('1 space');
    expect(container.querySelector('.change')!.textContent).toContain('We went');
  });

  it.each([
    ['hi', '2 स्पेस'],
    ['bn', '2টি স্পেস'],
  ] as const)('%s: names the spaces', (language, said) => {
    const text = 'We went  home today.';
    const { container } = renderLog([applied('s', '  ', ' ', 'Formatting', text)], text, language);
    expect(container.querySelector('.change del .visually-hidden')!.textContent).toBe(said);
  });

  it('names an invisible character it deleted', () => {
    const text = 'mod\u{200B}els here';
    const { container } = renderLog([{ ...applied('z', '\u{200B}', '', 'Invisible', text), auto: true, batch: undefined }], text);
    expect(container.querySelector('.change del')!.textContent).toBe('‹U+200B›');
  });
});
