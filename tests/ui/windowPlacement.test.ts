// Remember the window (F22 item 5): what to restore from a saved placement, and when to centre instead.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MIN_WINDOW, restorePlan, type ScreenArea, type WindowPlacement } from '@/ui/state/windowPlacement';

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

  // Task F24 (F23 adversarial review M-39): Tauri takes whole pixels only, so a hand-edited or corrupt window.json
  // must not reach setSize or setPosition as it is.
  describe('a hand-edited or corrupt placement', () => {
    it('fractional values are rounded to whole pixels', () => {
      expect(restorePlan({ x: 2100.6, y: 99.5, width: 1400.4, height: 899.5, maximized: false }, [LAPTOP, SECOND])).toEqual({
        width: 1400,
        height: 900,
        position: { x: 2101, y: 100 },
        maximized: false,
      });
    });

    it('a size is clamped between the window minimum and the largest monitor', () => {
      expect(restorePlan({ ...SAVED, width: 1.5, height: 2 }, [LAPTOP, SECOND])).toEqual({ ...at(2100, 100), width: MIN_WINDOW.width, height: MIN_WINDOW.height });
      expect(restorePlan({ ...SAVED, width: 1e12, height: 1e12 }, [LAPTOP, SECOND])).toEqual({ ...at(2100, 100), width: 2560, height: 1400 });
    });

    it('a huge position is on no monitor: centred', () => {
      expect(restorePlan({ ...SAVED, x: 1e12, y: -1e12 }, [LAPTOP])).toEqual(centred);
    });

    it('a negative position that leaves the title bar on screen is kept (a window at the left edge)', () => {
      expect(restorePlan({ ...SAVED, x: -8, y: 0 }, [LAPTOP])).toEqual(at(-8, 0));
    });

    it.each([
      ['a negative size', { ...SAVED, width: -1400 }],
      ['NaN', { ...SAVED, height: Number.NaN }],
      ['infinity', { ...SAVED, x: Number.POSITIVE_INFINITY }],
      ['a string', { ...SAVED, width: '1400' }],
      ['null', { ...SAVED, y: null }],
    ])('%s is ignored', (_name, saved) => {
      expect(restorePlan(saved, [LAPTOP, SECOND])).toBeNull();
    });

    it('with no monitor known there is no bound for the size: ignored', () => {
      expect(restorePlan(SAVED, [])).toBeNull();
    });

    it('the minimum is the window’s own minimum in tauri.conf.json', () => {
      const config = JSON.parse(fs.readFileSync(path.resolve('src-tauri/tauri.conf.json'), 'utf8'));
      const { minWidth, minHeight } = config.app.windows[0];
      expect(MIN_WINDOW).toEqual({ width: minWidth, height: minHeight });
    });
  });
});
