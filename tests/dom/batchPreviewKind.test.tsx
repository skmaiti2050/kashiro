/**
 * Task F21 item D (owner): the simple-fixes preview didn't say what kind each row was, so `sudo su ubuntu → Ubuntu`
 * could be spelling or capitals. Each row now shows its kind as a muted label, read as part of the row's name.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Candidate } from '@/engine/types';
import { BatchPreview } from '@/ui/BatchPreview';
import { createTranslator } from '@/ui/i18n/translator';
import { TranslatorProvider } from '@/ui/i18n/useT';

const TEXT = 'he went home . then we left.';
const at = (original: string, from = 0) => TEXT.indexOf(original, from);
const member = (id: string, original: string, replacement: string, kind: string, start = at(original)): Candidate => ({
  id,
  paraId: 0,
  span: { start, end: start + original.length },
  original,
  replacements: [replacement],
  kind,
  message: '',
  source: 'rules',
});
const MEMBERS = [member('c', 'he', 'He', 'Capitalization'), member('p', ' .', '.', 'Punctuation'), member('f', ' ', '', 'Formatting', at(' then') - 1)];

function view(language: 'en' | 'hi' | 'bn' = 'en') {
  return render(
    <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
      <BatchPreview members={MEMBERS} replacementIndex={0} paraText={new Map([[0, TEXT]])} onApply={() => {}} onCancel={() => {}} />
    </TranslatorProvider>,
  );
}

describe('BatchPreview: each row names its kind (Task F21 item D)', () => {
  it('a muted label on each row, part of its checkbox\'s accessible name', () => {
    const { container } = view();
    expect([...container.querySelectorAll('.member-kind')].map((k) => k.textContent)).toEqual(['Capital letters', 'Punctuation', 'Formatting']);
    expect(screen.getAllByRole('checkbox').map((box) => /Capital letters|Punctuation|Formatting/.exec(box.closest('label')!.textContent!)?.[0])).toEqual(['Capital letters', 'Punctuation', 'Formatting']);
    expect(screen.getByRole('checkbox', { name: /Capital letters/ })).toBeTruthy();
  });

  it.each(['hi', 'bn'] as const)('in %s too, from the kind names already translated', (language) => {
    const { container } = view(language);
    const t = createTranslator(language, ['en-IN']);
    const labels = [...container.querySelectorAll('.member-kind')].map((k) => k.textContent);
    expect(labels).toEqual([t.t('kind.Capitalization'), t.t('kind.Punctuation'), t.t('kind.Formatting')]);
    expect(labels[0]).not.toBe('Capital letters');
  });

  it('passes axe', async () => {
    const axe = (await import('axe-core')).default;
    const { container } = view();
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
