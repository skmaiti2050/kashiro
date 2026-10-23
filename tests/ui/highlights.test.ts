import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { CheckSession } from '@/engine/session';
import { paragraphAt, toEditorPosition } from '@/ui/state/highlights';
import type { OpenDocument } from '@/ui/state/openDocument';

describe('paragraphAt (the caret, for "Improve this sentence")', () => {
  const doc = (text: string, lineSeparator: '\n' | '\r\n', starts: [number, number][]): OpenDocument => ({
    id: 1,
    name: 'a.txt',
    path: null,
    text,
    lineSeparator,
    editable: true,
    paraStarts: new Map(starts),
    note: null,
  });
  const sessionOf = (paras: string[]) => ({ paragraphs: () => paras.map((text, id) => ({ id, text })) }) as unknown as CheckSession;

  it('maps an editor position to its paragraph and the offset in it (CRLF counts one position per line break)', () => {
    const text = 'One. Two.\r\n\r\nThree four.\r\nFive.';
    const d = doc(text, '\r\n', [
      [0, 0],
      [1, 13],
    ]);
    const session = sessionOf(['One. Two.', 'Three four.\r\nFive.']);
    const at = toEditorPosition(text, '\r\n');
    expect(paragraphAt(d, text, session, at(5))).toEqual({ paraId: 0, offset: 5 });
    expect(paragraphAt(d, text, session, at(text.indexOf('Five')))).toEqual({ paraId: 1, offset: 13 });
    // On the blank line between paragraphs: the paragraph before it, at its end.
    expect(paragraphAt(d, text, session, at(11))).toEqual({ paraId: 0, offset: 9 });
  });

  it('null while the view or the session lags behind the text (a re-check is on its way)', () => {
    const d = doc('One.', '\n', [[0, 0]]);
    expect(paragraphAt(d, 'One. More.', sessionOf(['One.']), 2)).toBeNull();
    expect(paragraphAt(d, 'One.', sessionOf(['Other.']), 2)).toBeNull();
  });
});

describe('toEditorPosition', () => {
  it('is the identity for LF text', () => {
    expect(toEditorPosition('a\nb', '\n')(2)).toBe(2);
  });

  it('matches CodeMirror positions for CRLF text read with a CRLF line separator', () => {
    const text = "I can't go.\r\n\r\nYou can't stay.\r\nEnd";
    const state = EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of('\r\n')] });
    expect(state.sliceDoc()).toBe(text);
    const at = toEditorPosition(text, '\r\n');
    for (const word of ["can't", 'stay', 'End']) {
      const offset = text.lastIndexOf(word);
      expect(state.sliceDoc(at(offset), at(offset + word.length))).toBe(word);
    }
  });
});
