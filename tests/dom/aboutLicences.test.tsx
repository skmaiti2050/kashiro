// About › Third-party notices (F22 item 9): a list of licence names; choosing one shows only that text, with Back.
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AboutDialog } from '@/ui/AboutDialog';
import { THIRD_PARTY_NOTICES } from '@/ui/notices';

const FONTS = 'Fonts (SIL Open Font License)';
const notices = () => screen.getByRole('dialog', { name: 'About Kashiro' }).querySelector('.notices')!;

describe('About licences', () => {
  it('lists every notice by name as a button in a list, with no licence text shown', () => {
    render(<AboutDialog onClose={() => {}} />);
    const list = within(notices() as HTMLElement).getByRole('list');
    const names = within(list).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(THIRD_PARTY_NOTICES.map((n) => n.title));
    expect(notices().textContent).not.toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(notices().querySelectorAll('details')).toHaveLength(0);
  });

  it('choosing one shows only its text under its name, focused on Back; Back returns to the list on that name', () => {
    render(<AboutDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: FONTS }));
    expect(screen.queryByRole('button', { name: 'Open English WordNet (word lookup)' })).toBeNull();
    expect(screen.getByRole('heading', { name: FONTS })).toBeTruthy();
    expect(notices().textContent).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(notices().textContent).not.toContain('Creative Commons Attribution 4.0 International License');
    const back = screen.getByRole('button', { name: 'Back to the list' });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(within(notices() as HTMLElement).getAllByRole('button')).toHaveLength(THIRD_PARTY_NOTICES.length);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: FONTS }));
  });
});
