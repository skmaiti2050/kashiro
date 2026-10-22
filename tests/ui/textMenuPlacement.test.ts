// Task 11b UI fix round 1: the right-click menu stays inside the window.
import { describe, it, expect } from 'vitest';
import { placeInViewport } from '@/ui/TextMenu';

const menu = { width: 200, height: 80 };
const viewport = { width: 760, height: 480 };

describe('placeInViewport', () => {
  it('opens at the pointer when it fits', () => {
    expect(placeInViewport({ x: 100, y: 50 }, menu, viewport)).toEqual({ x: 100, y: 50 });
  });

  it('moves left and up near the right and bottom edges, keeping a 4 px margin', () => {
    expect(placeInViewport({ x: 700, y: 460 }, menu, viewport)).toEqual({ x: 556, y: 396 });
  });

  it('never goes past the top-left corner, even when the window is smaller than the menu', () => {
    expect(placeInViewport({ x: 10, y: 10 }, menu, { width: 150, height: 60 })).toEqual({ x: 4, y: 4 });
  });
});
