// RTL readiness (Task L1): the UI CSS uses logical properties only, so an Urdu UI later is CSS-only.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/** A physical left/right property or value ("margin-left: 6px", "border-right:", "left: 0", "text-align: right"). */
const PHYSICAL_SIDE = /(?:^|[\s;{])(?:(?:margin|padding|border|inset)-(?:left|right)\b|(?:left|right)\s*:|(?:text-align|float|clear)\s*:\s*(?:left|right)\b)/;

/** A four-value margin or padding ("padding: 2px 4px 2px 10px"): its right and left values are physical. */
const FOUR_SIDES = /^(?:margin|padding)\s*:\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*;/;

/** A declaration that would not mirror in a right-to-left layout. */
function isPhysical(declaration: string): boolean {
  if (PHYSICAL_SIDE.test(declaration)) return true;
  const sides = FOUR_SIDES.exec(declaration);
  return sides !== null && sides[2] !== sides[4];
}

describe('RTL readiness', () => {
  it.each(['src/ui/app.css', 'src/ui/a11y.css'])('%s has no physical left/right properties', (path) => {
    const lines = readFileSync(path, 'utf8').split('\n');
    const physical = lines.flatMap((line, i) => (isPhysical(line.trim()) ? [`${i + 1}: ${line.trim()}`] : []));
    expect(physical).toEqual([]);
  });

  it('the check itself catches each physical form and passes logical ones', () => {
    for (const bad of ['margin-left: 6px;', 'border-right: 1px solid;', 'left: 0;', 'text-align: left;', 'padding: 2px 4px 2px 10px;']) expect(isPhysical(bad), bad).toBe(true);
    for (const good of ['margin-inline-start: 6px;', 'inset-inline-end: 0;', 'text-align: start;', 'padding: 0 12px 8px;', 'padding: 1px 2px 3px 2px;']) expect(isPhysical(good), good).toBe(false);
  });
});
