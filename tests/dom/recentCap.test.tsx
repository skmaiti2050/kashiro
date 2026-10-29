// The start screen's recent list (F22 item 6): the 8 newest saved reviews, then "Show all (N)".
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { RecentReviews } from '@/ui/RecentReviews';
import type { RecentReview } from '@/ui/state/sessionStore';

/** `count` reviews, newest first, as SessionStore.list() returns them. */
const reviews = (count: number): RecentReview[] =>
  Array.from({ length: count }, (_, i) => ({
    key: `k${i}`,
    name: `doc${i}.txt`,
    path: `/docs/doc${i}.txt`,
    updated: new Date(Date.UTC(2026, 9, 28 - i)).toISOString(),
    made: i,
    left: 1,
  }));

const rows = () => within(screen.getByRole('region', { name: 'Recent reviews' })).getAllByRole('listitem');

describe('recent reviews cap', () => {
  it('shows the 8 newest and "Show all (12)"; choosing it lists all 12 and the button goes', () => {
    render(<RecentReviews reviews={reviews(12)} onOpen={() => {}} />);
    expect(rows()).toHaveLength(8);
    expect(rows()[0].textContent).toContain('doc0.txt');
    expect(rows()[7].textContent).toContain('doc7.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Show all (12)' }));
    expect(rows()).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('8 or fewer: all of them and no "Show all"', () => {
    render(<RecentReviews reviews={reviews(8)} onOpen={() => {}} />);
    expect(rows()).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });
});
