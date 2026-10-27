import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SIMPLE_FIXES_ID, type Decision } from '@/engine/decisions';
import type { CheckSession } from '@/engine/session';
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
/** These cards are rendered alone: no check runs, so the session is only compared by identity. */
const NO_SESSION = {} as CheckSession;

function renderCard(language: 'en' | 'hi' | 'bn') {
  render(
    <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
      <DecisionCard
        controller={{} as SessionController}
        decision={decision}
        candidates={new Map([['c1', repeated]])}
        paraText={new Map([[0, PARA]])}
        touchesLocked={false}
        session={NO_SESSION}
        checking={false}
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
          session={NO_SESSION}
          checking={false}
          onNext={() => {}}
          onLocate={() => {}}
          onLookUp={() => {}}
        />
      </TranslatorProvider>,
    );
  }

  it.each([
    // What starts ticked: only repeated words (Task F8), and no mention of a/an.
    ['en', '3 simple fixes: review and apply all', 'Review and apply all 3', 'Only repeated words start ticked.'],
    ['hi', '3 आसान सुधार: देखें और सभी लागू करें', 'देखें और सभी 3 लागू करें', 'सिर्फ़ दोहराए गए शब्दों के सुधार पहले से निशान के साथ आते हैं।'],
    ['bn', '3টি সহজ সংশোধন: দেখে সব বসান', 'দেখে 3টিই বসান', 'শুধু পুনরাবৃত্ত শব্দের সংশোধনগুলোয় আগে থেকেই টিক দেওয়া থাকে।'],
  ] as const)('%s: names itself, explains itself and opens the preview, with no word or rule actions', (language, title, apply, explained) => {
    renderSimple(language);
    expect(screen.getByRole('heading').textContent).toBe(title);
    expect(document.querySelector('.kind')!.textContent).toContain(explained);
    expect(document.querySelector('.kind')!.textContent).not.toContain('a/an');
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

describe('DecisionCard: the review-tier "Repeated words" card starts with nothing ticked (F8 re-review 7, M-4)', () => {
  const TEXT = 'He had had enough. The film was very very good.';
  const doubling = (id: string, original: string): Candidate => {
    const start = TEXT.indexOf(original);
    const word = original.split(' ')[0];
    return { id, paraId: 0, span: { start, end: start + original.length }, original, replacements: [word], kind: 'Repetition', message: 'Repeated word.', source: 'rules' };
  };
  const members = [doubling('h', 'had had'), doubling('v', 'very very')];
  const card: Decision = { id: 'batch:repeated-words', kind: 'batch', candidateIds: ['h', 'v'], label: 'Repeated words (2 places)', score: 4, startUnticked: ['h', 'v'] };

  it.each([
    ['en', 'Choose which to fix…', 'Nothing starts ticked. Tick each place you want to fix.', 'Apply 0 of 2'],
    ['hi', 'चुनें कि कौन-से सुधार लागू करें…', 'शुरू में किसी पर निशान नहीं है। जिस जगह को सुधारना हो, उस पर निशान लगाएँ।', '2 में से 0 लागू करें'],
    ['bn', 'কোনগুলো বসাবেন, বেছে নিন…', 'শুরুতে কোনোটিতেই টিক নেই। যে জায়গাগুলোয় সংশোধন চান, সেগুলোয় টিক দিন।', '2টির মধ্যে 0টি বসান'],
  ] as const)('%s: the button says the user chooses, and the preview says nothing is ticked', (language, choose, hint, apply) => {
    const onApply = vi.fn();
    const controller = { applyBatch: onApply } as unknown as SessionController;
    render(
      <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
        <DecisionCard
          controller={controller}
          decision={card}
          candidates={new Map(members.map((c) => [c.id, c]))}
          paraText={new Map([[0, TEXT]])}
          touchesLocked={false}
          session={NO_SESSION}
          checking={false}
          onNext={() => {}}
          onLocate={() => {}}
        />
      </TranslatorProvider>,
    );
    const button = screen.getAllByRole('button').find((b) => b.getAttribute('data-key') === 'accept')!;
    expect(button.textContent).toBe(`${choose}Enter`);

    fireEvent.click(button);
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').map((b) => b.checked)).toEqual([false, false]);
    expect(document.querySelector('.batch-preview .hint')!.textContent).toBe(hint);
    const applyButton = screen.getAllByRole<HTMLButtonElement>('button').find((b) => b.getAttribute('data-key') === 'accept')!;
    expect(applyButton.textContent).toBe(`${apply} Enter`);
    expect(applyButton.disabled).toBe(true);
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('DecisionCard: a batch card with a choice of fixes starts with nothing ticked (Task F10)', () => {
  const TEXT = 'I recieve mail. They recieve calls.';
  const spelling = (id: string, start: number): Candidate => ({ id, paraId: 0, span: { start, end: start + 7 }, original: 'recieve', replacements: ['receive', 'relieve'], kind: 'Spelling', message: 'Did you mean to spell “recieve” this way?', source: 'rules' });
  const members = [spelling('r1', TEXT.indexOf('recieve')), spelling('r2', TEXT.lastIndexOf('recieve'))];
  const card: Decision = { id: 'batch:word:Spelling:recieve', kind: 'batch', candidateIds: ['r1', 'r2'], label: 'recieve → receive / relieve (2 places)', score: 3, startUnticked: ['r1', 'r2'] };

  it.each([
    ['en', ['Choose where to use “receive”…Enter', 'Choose where to use “relieve”…'], 'Nothing starts ticked. Tick each place you want to fix.'],
    ['hi', ['चुनें कि “receive” कहाँ लागू करें…Enter', 'चुनें कि “relieve” कहाँ लागू करें…'], 'शुरू में किसी पर निशान नहीं है। जिस जगह को सुधारना हो, उस पर निशान लगाएँ।'],
    ['bn', ['“receive” কোথায় বসাবেন, বেছে নিন…Enter', '“relieve” কোথায় বসাবেন, বেছে নিন…'], 'শুরুতে কোনোটিতেই টিক নেই। যে জায়গাগুলোয় সংশোধন চান, সেগুলোয় টিক দিন।'],
  ] as const)('%s: each fix button says the user chooses the places, and its preview starts unticked', (language, choose, hint) => {
    const onApply = vi.fn();
    render(
      <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
        <DecisionCard
          controller={{ applyBatch: onApply } as unknown as SessionController}
          decision={card}
          candidates={new Map(members.map((c) => [c.id, c]))}
          paraText={new Map([[0, TEXT]])}
          touchesLocked={false}
          session={NO_SESSION}
          checking={false}
          onNext={() => {}}
          onLocate={() => {}}
        />
      </TranslatorProvider>,
    );
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(names.slice(0, 2)).toEqual(choose);

    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').map((b) => b.checked)).toEqual([false, false]);
    expect(document.querySelector('.batch-preview .hint')!.textContent).toBe(hint);
    const applyButton = screen.getAllByRole<HTMLButtonElement>('button').find((b) => b.getAttribute('data-key') === 'accept')!;
    expect(applyButton.disabled).toBe(true);
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
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
