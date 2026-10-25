import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Candidate } from '@/engine/types';
import { BatchPreview } from '@/ui/BatchPreview';
import { DismissMenu } from '@/ui/DismissMenu';

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

  it('with nothing ticked, Apply is disabled; Cancel cancels', () => {
    const onCancel = vi.fn();
    render(<BatchPreview members={members} replacementIndex={0} paraText={new Map([[0, para]])} onApply={() => {}} onCancel={onCancel} />);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^Apply 0 of 2/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
