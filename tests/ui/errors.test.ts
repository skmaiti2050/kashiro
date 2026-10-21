// Error messages say what happened and what to do (Task A1 item 6), in the UI language (Task L1).
import { describe, it, expect } from 'vitest';
import { msg } from '@/ui/i18n/message';
import { explain } from '@/ui/state/errors';
import { english } from './english';

describe('explain', () => {
  it('what happened, the cause, then the next step', () => {
    expect(english(explain(msg('error.save', { name: 'essay.docx' }), new Error('access denied'), msg('error.saveAgain')))).toBe(
      'Couldn’t save essay.docx: access denied. Close the file if another program has it open, or choose another folder, then save again.',
    );
  });

  it('a cause that already ends a sentence is not given a second full stop', () => {
    expect(english(explain(msg('error.open', { name: 'a.docx' }), new Error('This is not a Word document.'), msg('error.openNext')))).toMatch(
      /^Can’t open a\.docx: This is not a Word document\. Check/,
    );
    expect(english(explain(msg('error.check'), 'Out of memory!', msg('error.checkNext')))).toBe('The check failed: Out of memory! Edit the text or reopen the file to try again.');
  });
});
