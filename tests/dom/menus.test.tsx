import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Candidate } from '@/engine/types';
import { BatchPreview } from '@/ui/BatchPreview';
import { DismissMenu } from '@/ui/DismissMenu';
import { MoreMenu } from '@/ui/MoreMenu';

// Task F17: the toolbar's ⋯ menu took the review card menu's start anchor, so at the toolbar's end its 280 px ran
// past the window's edge (x 1041 to 1321 in a 1200 px window). jsdom has no layout, so the check is on the real CSS.
describe('menus stay inside the window (Task F17)', () => {
  const style = document.createElement('style');
  beforeAll(() => {
    style.textContent = readFileSync('src/ui/app.css', 'utf8');
    document.head.append(style);
  });
  afterAll(() => style.remove());

  /** The open menu's position and width rules, inside a layout of direction `dir`. */
  const openMenu = (dir: 'ltr' | 'rtl', menu: 'more' | 'dismiss' | 'save') => {
    render(
      <div dir={dir} className="toolbar">
        {menu === 'more' && <MoreMenu items={[{ label: 'Settings', onChoose: () => {} }]} />}
        {menu === 'dismiss' && <DismissMenu kind="WordChoice" thisOneLabel="This one" onThisOne={() => {}} onRule={() => {}} />}
        {menu === 'save' && (
          <div className="save-group">
            <details className="save-menu" open>
              <summary>▾</summary>
              <div className="menu" />
            </details>
          </div>
        )}
      </div>,
    );
    if (menu !== 'save') fireEvent.click(screen.getByRole('button', { name: menu === 'more' ? 'More' : 'Dismiss ▾' }));
    const css = getComputedStyle(document.querySelector('.menu')!);
    return { start: css.insetInlineStart, end: css.insetInlineEnd, maxWidth: css.maxWidth };
  };

  // Logical insets mirror by themselves: the same rules keep the menu inside in a right-to-left layout.
  it.each(['ltr', 'rtl'] as const)('%s: the ⋯ menu at the toolbar’s end opens towards the start', (dir) => {
    expect(openMenu(dir, 'more')).toEqual({ start: 'auto', end: '0px', maxWidth: 'calc(100vw - 16px)' });
  });

  it.each(['ltr', 'rtl'] as const)('%s: the review card’s Dismiss ▾ menu still opens towards the end, no wider than the window', (dir) => {
    expect(openMenu(dir, 'dismiss')).toEqual({ start: '0px', end: 'auto', maxWidth: 'calc(100vw - 16px)' });
  });

  it.each(['ltr', 'rtl'] as const)('%s: the Save ▾ menu at the toolbar’s end opens towards the start, no wider than the window', (dir) => {
    expect(openMenu(dir, 'save')).toEqual({ start: 'auto', end: '0px', maxWidth: 'calc(100vw - 16px)' });
  });
});

describe('DismissMenu', () => {
  const renderMenu = () => {
    const onThisOne = vi.fn();
    const onRule = vi.fn();
    render(
      <div>
        <DismissMenu kind="WordChoice"thisOneLabel="This one" onThisOne={onThisOne} onRule={onRule} />
        <p>outside</p>
      </div>,
    );
    return { onThisOne, onRule, trigger: screen.getByRole('button', { name: 'Dismiss ▾' }) };
  };

  it('opens with the first item focused; Escape closes it and focus goes back to the trigger', () => {
    const { trigger } = renderMenu();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'This one' }));

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('a click outside closes it without choosing', () => {
    const { trigger, onThisOne, onRule } = renderMenu();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onThisOne).not.toHaveBeenCalled();
    expect(onRule).not.toHaveBeenCalled();
  });

  it('each item states its scope and calls its action once', () => {
    const { trigger, onThisOne, onRule } = renderMenu();
    fireEvent.click(trigger);
    // The kind by its label ("Word choice"), not its rule name ("WordChoice").
    fireEvent.click(screen.getByRole('menuitem', { name: 'All “Word choice” suggestions in this document' }));
    expect(onRule).toHaveBeenCalledWith('document');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /All “Word choice” suggestions everywhere/ }));
    expect(onRule).toHaveBeenLastCalledWith('everywhere');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'This one' }));
    expect(onThisOne).toHaveBeenCalledTimes(1);
  });
});

describe('BatchPreview', () => {
  const para = 'Each farmer should recieve water, and every family will recieve a card.';
  const member = (id: string, start: number): Candidate => ({
    id,
    paraId: 0,
    span: { start, end: start + 'recieve'.length },
    original: 'recieve',
    replacements: ['receive'],
    kind: 'Spelling',
    message: 'Did you mean “receive”?',
    source: 'rules',
  });
  const members = [member('a', para.indexOf('recieve')), member('b', para.lastIndexOf('recieve'))];

  it('starts with every place ticked; unticking one says "Apply 1 of 2" and applies only the ticked one', () => {
    const onApply = vi.fn();
    render(<BatchPreview members={members} replacementIndex={0} paraText={new Map([[0, para]])} onApply={onApply} onCancel={() => {}} />);
    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes.map((b) => b.checked)).toEqual([true, true]);
    expect(screen.getByRole('button', { name: /^Apply 2/ })).toBeTruthy();

    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole('button', { name: /^Apply 1 of 2/ }));
    expect(onApply).toHaveBeenCalledWith(['a']);
  });

  it('starts the simple-fixes card\'s unticked members unticked, and applies only the ticked ones (Task F5)', () => {
    const onApply = vi.fn();
    render(<BatchPreview members={members} replacementIndex={0} paraText={new Map([[0, para]])} onApply={onApply} onCancel={() => {}} startUnticked={['b']} />);
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').map((b) => b.checked)).toEqual([true, false]);
    fireEvent.click(screen.getByRole('button', { name: /^Apply 1 of 2/ }));
    expect(onApply).toHaveBeenCalledWith(['a']);
  });

  // Final F10 review I-1: it stored the unticked ids, so a member it hadn't seen showed ticked.
  it('a member it has not seen starts unticked, even with no startUnticked (Task F11)', () => {
    const onApply = vi.fn();
    const props = { replacementIndex: 0, paraText: new Map([[0, para]]), onApply, onCancel: () => {} };
    const { rerender } = render(<BatchPreview members={members} startUnticked={['a', 'b']} {...props} />);
    const shifted = [member('a2', members[0].span.start), member('b2', members[1].span.start)];
    rerender(<BatchPreview members={shifted} {...props} />);
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').map((b) => b.checked)).toEqual([false, false]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^Apply 0 of 2/ }).disabled).toBe(true);
  });

  it('with nothing ticked, Apply is disabled; Cancel cancels', () => {
    const onCancel = vi.fn();
    render(<BatchPreview members={members} replacementIndex={0} paraText={new Map([[0, para]])} onApply={() => {}} onCancel={onCancel} />);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^Apply 0 of 2/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
