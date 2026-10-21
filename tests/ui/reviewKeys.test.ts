// The review loop's keys (U1 item 1) and the app shortcuts (item 8), without a DOM.
import { describe, it, expect } from 'vitest';
import { appShortcut, reviewKeyAction, type KeyPress, type KeyTarget } from '@/ui/state/reviewKeys';

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
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

  it('ignores other chords', () => {
    expect(appShortcut(press('o'), false, 'none')).toBeNull();
    expect(appShortcut(press('v', { ctrlKey: true, shiftKey: true }), false, 'none')).toBeNull();
  });
});
