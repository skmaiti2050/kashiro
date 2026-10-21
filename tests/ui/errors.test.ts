// Error messages say what happened and what to do (Task A1 item 6).
import { describe, it, expect } from 'vitest';
import { explain } from '@/ui/state/errors';

describe('explain', () => {
  it('what happened, the cause, then the next step', () => {
    expect(explain("Couldn't save essay.docx", new Error('access denied'), 'Choose another folder and save again.')).toBe(
      "Couldn't save essay.docx: access denied. Choose another folder and save again.",
    );
  });

  it('a cause that already ends a sentence is not given a second full stop', () => {
    expect(explain("Can't open a.docx", new Error('This is not a Word document.'), 'Try again.')).toBe("Can't open a.docx: This is not a Word document. Try again.");
    expect(explain('The check failed', 'Out of memory!', 'Try again.')).toBe('The check failed: Out of memory! Try again.');
  });
});
