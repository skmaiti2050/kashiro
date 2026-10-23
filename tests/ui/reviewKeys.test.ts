// The review loop's keys (U1 item 1) and the app shortcuts (item 8), without a DOM.
import { describe, it, expect } from 'vitest';
import { appShortcut, isImproveKey, isLookUpKey, readAloudKey, reviewKeyAction, type KeyPress, type KeyTarget } from '@/ui/state/reviewKeys';

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  ...mods,
});
const panel: KeyTarget = { place: 'panel', control: 'none', documentEditable: true, textSelected: false };
const readOnlyDoc: KeyTarget = { place: 'document', control: 'none', documentEditable: false, textSelected: false };

describe('reviewKeyAction', () => {
  it('in the review panel: Enter accepts, Backspace and Delete reject, J/K move', () => {
    const keys = ['Enter', 'Backspace', 'Delete', 'j', 'k', 'J', 'K', 'x'];
    expect(keys.map((k) => reviewKeyAction(press(k), panel))).toEqual(['accept', 'reject', 'reject', 'next', 'previous', 'next', 'previous', null]);
  });

  it('never fires while typing in the editable document', () => {
    const typing: KeyTarget = { place: 'document', control: 'text-entry', documentEditable: true, textSelected: false };
    for (const k of ['Enter', 'Backspace', 'j', 'k']) expect(reviewKeyAction(press(k), typing)).toBeNull();
    // Even with focus outside the text (the pane itself), an editable document keeps its keys.
    expect(reviewKeyAction(press('Enter'), { ...typing, control: 'none' })).toBeNull();
  });

  it('works in a read-only document with nothing selected, not with a selection', () => {
    expect(reviewKeyAction(press('Enter'), readOnlyDoc)).toBe('accept');
    expect(reviewKeyAction(press('Backspace'), { ...readOnlyDoc, textSelected: true })).toBeNull();
  });

  it('leaves text fields, the toolbar, dialogs and modified keys alone', () => {
    expect(reviewKeyAction(press('Backspace'), { ...panel, control: 'text-entry' })).toBeNull();
    expect(reviewKeyAction(press('Enter'), { ...panel, place: 'other' })).toBeNull();
    expect(reviewKeyAction(press('Enter', { ctrlKey: true }), panel)).toBeNull();
    expect(reviewKeyAction(press('k', { altKey: true }), panel)).toBeNull();
  });

  it('a held Enter or Backspace decides one card only; held J/K keep moving', () => {
    expect(reviewKeyAction(press('Enter', { repeat: true }), panel)).toBeNull();
    expect(reviewKeyAction(press('Backspace', { repeat: true }), panel)).toBeNull();
    expect(reviewKeyAction(press('Delete', { repeat: true }), panel)).toBeNull();
    expect(reviewKeyAction(press('j', { repeat: true }), panel)).toBe('next');
    expect(reviewKeyAction(press('k', { repeat: true }), panel)).toBe('previous');
  });

  it('Enter on a focused button or checkbox does its own job; Backspace and J/K still work there', () => {
    const onButton: KeyTarget = { ...panel, control: 'control' };
    expect(reviewKeyAction(press('Enter'), onButton)).toBeNull();
    expect(reviewKeyAction(press('Backspace'), onButton)).toBe('reject');
    expect(reviewKeyAction(press('j'), onButton)).toBe('next');
  });
});

describe('appShortcut', () => {
  it('Ctrl+O opens from anywhere', () => {
    expect(appShortcut(press('o', { ctrlKey: true }), true, 'text-entry')).toBe('open');
    expect(appShortcut(press('O', { ctrlKey: true }), false, 'none')).toBe('open');
  });

  it('Ctrl+V pastes a new document only on the empty start screen', () => {
    expect(appShortcut(press('v', { ctrlKey: true }), false, 'none')).toBe('paste');
    expect(appShortcut(press('v', { ctrlKey: true }), true, 'none')).toBeNull();
    expect(appShortcut(press('v', { ctrlKey: true }), false, 'text-entry')).toBeNull();
  });

  it('Ctrl+W closes the document, from anywhere, only when one is open (Task U3 item 5)', () => {
    expect(appShortcut(press('w', { ctrlKey: true }), true, 'text-entry')).toBe('close');
    expect(appShortcut(press('W', { ctrlKey: true }), true, 'none')).toBe('close');
    expect(appShortcut(press('w', { ctrlKey: true }), false, 'none')).toBeNull();
  });

  it('ignores other chords', () => {
    expect(appShortcut(press('o'), false, 'none')).toBeNull();
    expect(appShortcut(press('v', { ctrlKey: true, shiftKey: true }), false, 'none')).toBeNull();
  });

  it('F1 opens the keyboard shortcuts from anywhere; ? only where it would not type a question mark', () => {
    expect(appShortcut(press('F1'), true, 'text-entry')).toBe('shortcuts');
    expect(appShortcut(press('?', { shiftKey: true }), true, 'none')).toBe('shortcuts');
    expect(appShortcut(press('?', { shiftKey: true }), true, 'control')).toBe('shortcuts');
    expect(appShortcut(press('?', { shiftKey: true }), true, 'text-entry')).toBeNull();
    expect(appShortcut(press('F1', { ctrlKey: true }), true, 'none')).toBeNull();
  });

  it('Ctrl+, opens Settings', () => {
    expect(appShortcut(press(',', { ctrlKey: true }), true, 'text-entry')).toBe('settings');
    expect(appShortcut(press(','), true, 'none')).toBeNull();
  });
});

describe('readAloudKey', () => {
  it('Alt+S reads the sentence, Alt+R the suggestion, Alt+P the paragraph, from anywhere', () => {
    expect(['s', 'S', 'r', 'p', 'x'].map((k) => readAloudKey(press(k, { altKey: true })))).toEqual(['sentence', 'sentence', 'suggestion', 'paragraph', null]);
  });

  it('needs Alt alone: Ctrl+Alt is AltGr on many keyboards and types letters', () => {
    expect(readAloudKey(press('s'))).toBeNull();
    expect(readAloudKey(press('s', { altKey: true, ctrlKey: true }))).toBeNull();
    expect(readAloudKey(press('s', { altKey: true, shiftKey: true }))).toBeNull();
    expect(readAloudKey(press('s', { altKey: true, repeat: true }))).toBeNull();
  });
});

describe('isImproveKey', () => {
  it('Ctrl+I, either case, once per press; not with Shift, Alt (AltGr) or the Windows key', () => {
    expect(isImproveKey(press('i', { ctrlKey: true }))).toBe(true);
    expect(isImproveKey(press('I', { ctrlKey: true }))).toBe(true);
    expect(isImproveKey(press('i', { ctrlKey: true, repeat: true }))).toBe(false);
    expect(isImproveKey(press('i'))).toBe(false);
    expect(isImproveKey(press('I', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isImproveKey(press('i', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isImproveKey(press('d', { ctrlKey: true }))).toBe(false);
  });
});

describe('isLookUpKey', () => {
  it('Ctrl+D, either case, once per press', () => {
    expect(isLookUpKey(press('d', { ctrlKey: true }))).toBe(true);
    expect(isLookUpKey(press('D', { ctrlKey: true }))).toBe(true);
    expect(isLookUpKey(press('d', { ctrlKey: true, repeat: true }))).toBe(false);
  });

  it('not D alone, nor with Shift, Alt (AltGr) or the Windows key', () => {
    expect(isLookUpKey(press('d'))).toBe(false);
    expect(isLookUpKey(press('D', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isLookUpKey(press('d', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isLookUpKey(press('d', { ctrlKey: true, metaKey: true }))).toBe(false);
  });
});
