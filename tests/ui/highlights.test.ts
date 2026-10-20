import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { toEditorPosition } from '@/ui/state/highlights';

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
