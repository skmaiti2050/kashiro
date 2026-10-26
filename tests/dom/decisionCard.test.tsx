import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SIMPLE_FIXES_ID, type Decision } from '@/engine/decisions';
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

describe('DecisionCard: the simple-fixes card (Task F4)', () => {
  const TEXT = 'I think teh cat of of mine ate a apple.';
  const fix = (id: string, original: string, replacement: string, kind: string): Candidate => {
    const start = TEXT.indexOf(original);
    return { id, paraId: 0, span: { start, end: start + original.length }, original, replacements: [replacement], kind, message: 'Did you mean the definite article?', source: 'rules' };
  };
  const members = [fix('t', 'teh', 'the', 'Typo'), fix('o', 'of of', 'of', 'Repetition'), fix('a', 'a apple', 'an apple', 'Miscellaneous')];
  const card: Decision = { id: SIMPLE_FIXES_ID, kind: 'batch', candidateIds: members.map((c) => c.id), label: '3 simple fixes', score: 10 };

  function renderSimple(language: 'en' | 'hi' | 'bn') {
    render(
      <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
        <DecisionCard
          controller={{} as SessionController}
          decision={card}
          candidates={new Map(members.map((c) => [c.id, c]))}
          paraText={new Map([[0, TEXT]])}
          touchesLocked={false}
          onNext={() => {}}
          onLocate={() => {}}
          onLookUp={() => {}}
        />
      </TranslatorProvider>,
    );
  }

  it.each([
    // What starts ticked: only the closed set (Task F6).
    ['en', '3 simple fixes: review and apply all', 'Review and apply all 3', 'Only repeated words and a/an fixes'],
    ['hi', '3 आसान सुधार: देखें और सभी लागू करें', 'देखें और सभी 3 लागू करें', 'सिर्फ़ दोहराए गए शब्द'],
    ['bn', '3টি সহজ সংশোধন: দেখে সব বসান', 'দেখে 3টিই বসান', 'শুধু পুনরাবৃত্ত শব্দ'],
  ] as const)('%s: names itself, explains itself and opens the preview, with no word or rule actions', (language, title, apply, explained) => {
    renderSimple(language);
    expect(screen.getByRole('heading').textContent).toBe(title);
    expect(document.querySelector('.kind')!.textContent).toContain(explained);
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names.some((name) => name.startsWith(apply))).toBe(true);
    // The first member's word is not the card's: no dictionary, ignore-all, look-up or dismiss-rule action.
    expect(document.querySelector('.dismiss-menu, [aria-haspopup]')).toBeNull();
    const en = createTranslator('en', ['en-IN']);
    for (const key of ['card.addToDictionary', 'card.ignoreAll', 'card.lookUp'] as const) {
      expect(names.some((name) => name.startsWith(createTranslator(language, ['en-IN']).t(key)))).toBe(false);
      expect(names.some((name) => name.startsWith(en.t(key)))).toBe(false);
    }
  });
});

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
