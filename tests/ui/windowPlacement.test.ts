// Remember the window (F22 item 5): what to restore from a saved placement, and when to centre instead.
import { describe, it, expect } from 'vitest';
import { restorePlan, type ScreenArea, type WindowPlacement } from '@/ui/state/windowPlacement';

const LAPTOP: ScreenArea = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND: ScreenArea = { x: 1920, y: 0, width: 2560, height: 1400 };
const SAVED: WindowPlacement = { x: 2100, y: 100, width: 1400, height: 900, maximized: false };

const at = (x: number, y: number) => ({ width: SAVED.width, height: SAVED.height, position: { x, y }, maximized: false });
const centred = { width: SAVED.width, height: SAVED.height, position: null, maximized: false };

describe('restorePlan', () => {
  it('a placement on a connected monitor comes back as it was', () => {
    expect(restorePlan(SAVED, [LAPTOP, SECOND])).toEqual(at(2100, 100));
    expect(restorePlan({ ...SAVED, maximized: true }, [LAPTOP, SECOND])).toEqual({ ...at(2100, 100), maximized: true });
  });

  it('the monitor it was on is unplugged: the same size, centred (position null)', () => {
    expect(restorePlan(SAVED, [LAPTOP])).toEqual(centred);
  });

  it('only a sliver of the title bar on screen counts as off screen; a good part of it does not', () => {
    expect(restorePlan({ ...SAVED, x: 1900 }, [LAPTOP])).toEqual(centred); // 20 px of title bar visible
    expect(restorePlan({ ...SAVED, x: 1700 }, [LAPTOP])).toEqual(at(1700, 100));
    expect(restorePlan({ ...SAVED, x: 100, y: -500 }, [LAPTOP])).toEqual(centred); // title bar above the screen
  });

  it('nothing saved, or something that is not a placement: null (left as Windows puts it)', () => {
    expect(restorePlan(undefined, [LAPTOP])).toBeNull();
    expect(restorePlan({ x: 1, y: 2 }, [LAPTOP])).toBeNull();
    expect(restorePlan({ ...SAVED, width: 0 }, [LAPTOP])).toBeNull();
    expect(restorePlan({ ...SAVED, maximized: 'yes' }, [LAPTOP])).toBeNull();
  });
});
