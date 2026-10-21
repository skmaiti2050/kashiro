import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from '@/ui/Dialog';

/** A page with an opener button and the dialog it opens. */
function Page({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open settings</button>
      {open && (
        <Dialog
          title="Settings"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <label>
            Name <input />
          </label>
          <button>Last</button>
        </Dialog>
      )}
    </>
  );
}

const opener = () => screen.getByRole('button', { name: 'Open settings' });

describe('Dialog', () => {
  it('is a labelled modal: aria-modal, its title as its name', () => {
    render(<Page />);
    fireEvent.click(opener());
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('takes focus on open and gives it back to the opener on close', () => {
    render(<Page />);
    opener().focus();
    fireEvent.click(opener());
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('Escape closes it, and focus returns', () => {
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);
    opener().focus();
    fireEvent.click(opener());
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener());
  });

  it('makes the rest of the page inert while it is open, and only while it is open', () => {
    render(<Page />);
    opener().focus();
    fireEvent.click(opener());
    expect(opener().closest('[inert]')).not.toBeNull();
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('Tab from the last control wraps to the first, Shift+Tab from the first to the last', () => {
    render(<Page />);
    fireEvent.click(opener());
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
