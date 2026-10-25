import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CheckSession, Outcome } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import { ChangeLog } from '@/ui/ChangeLog';
import { createTranslator } from '@/ui/i18n/translator';
import { TranslatorProvider } from '@/ui/i18n/useT';
import type { ControllerState, SessionController } from '@/ui/state/sessionController';

const applied = (id: string, original: string, replacement: string, kind: string): Outcome => {
  const candidate: Candidate = { id, paraId: 0, span: { start: 0, end: original.length }, original, replacements: [replacement], kind, message: '', source: 'rules' };
  return { candidate, paragraphNumber: 1, status: 'applied', auto: false, replacement, batch: 'batch-1' };
};

describe('ChangeLog: one row for the simple-fixes card (Task F4)', () => {
  it('names every kind the card applied, not only the first', () => {
    const outcomes = [applied('t', 'teh', 'the', 'Typo'), applied('o', 'of of', 'of', 'Repetition'), applied('a', 'a', 'an', 'Miscellaneous')];
    const state = { session: { outcomes: () => outcomes } as unknown as CheckSession } as ControllerState;
    render(
      <TranslatorProvider translator={createTranslator('en', ['en-IN'])}>
        <ChangeLog controller={{} as SessionController} state={state} open onToggle={() => {}} />
      </TranslatorProvider>,
    );
    expect(screen.getByText('3 fixes (Typos, Repeated words, Other) applied together')).toBeTruthy();
  });

  it('lists every change the card made, not only the first (F4 re-review 3, M-7)', () => {
    const outcomes = [applied('t', 'teh', 'the', 'Typo'), applied('o', 'of of', 'of', 'Repetition'), applied('a', 'a', 'an', 'Miscellaneous')];
    const state = { session: { outcomes: () => outcomes } as unknown as CheckSession } as ControllerState;
    const { container } = render(
      <TranslatorProvider translator={createTranslator('en', ['en-IN'])}>
        <ChangeLog controller={{} as SessionController} state={state} open onToggle={() => {}} />
      </TranslatorProvider>,
    );
    const changes = [...container.querySelectorAll('li.batch .change')].map((c) => c.textContent);
    expect(changes).toEqual(['teh → the', 'of of → of', 'a → an']);
  });
});
