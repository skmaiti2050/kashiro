import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { DecisionCard } from '@/ui/DecisionCard';
import { createTranslator } from '@/ui/i18n/translator';
import { TranslatorProvider } from '@/ui/i18n/useT';
import type { SessionController } from '@/ui/state/sessionController';

const PARA = 'We saw the the cat.';
const repeated: Candidate = {
  id: 'c1',
  paraId: 0,
  span: { start: 7, end: 14 },
  original: 'the the',
  replacements: ['the', ''],
  kind: 'Repetition',
  message: 'The word “the” is repeated.',
  source: 'rules',
};
const decision: Decision = { id: 'c1', kind: 'single', candidateIds: ['c1'], label: 'the the', score: 1 };

function renderCard(language: 'en' | 'hi' | 'bn') {
  render(
    <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
      <DecisionCard
        controller={{} as SessionController}
        decision={decision}
        candidates={new Map([['c1', repeated]])}
        paraText={new Map([[0, PARA]])}
        touchesLocked={false}
        onNext={() => {}}
        onLocate={() => {}}
      />
    </TranslatorProvider>,
  );
}

describe('DecisionCard: a choice that deletes the text (Task F2)', () => {
  it.each([
    ['en', 'Delete'],
    ['hi', 'हटाएँ'],
    ['bn', 'মুছে দিন'],
  ] as const)('%s: the button has its own whole label, not "Use" + "delete"', (language, label) => {
    renderCard(language);
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names.some((name) => name.startsWith(label))).toBe(true);
  });
});
