import { describe, expect, it } from 'vitest';
import { decisionsVerdict } from '../../scripts/deps/referenceValues';

const RECORDED = '13899ab0dbc2f943b945935decef8f06';

describe('decisionsVerdict (upgrade:check, trust/out/decisions.md against reference-values.json)', () => {
  it('fails, and records nothing, when the decisions table is missing', () => {
    expect(decisionsVerdict(undefined, RECORDED)).toEqual({
      failed: true,
      record: false,
      line: 'Decisions table (trust/out/decisions.md) is MISSING: the decisions test did not write it. reference-values.json left as it was.',
    });
  });

  it('passes when the table is unchanged', () => {
    expect(decisionsVerdict(RECORDED, RECORDED)).toEqual({
      failed: false,
      record: true,
      line: `Decisions table (trust/out/decisions.md) md5 ${RECORDED}: unchanged.`,
    });
  });

  it('records a changed table and points at the copy to read', () => {
    expect(decisionsVerdict('ffff', RECORDED)).toEqual({
      failed: false,
      record: true,
      line: `Decisions table (trust/out/decisions.md) md5 ffff: CHANGED (was ${RECORDED}); read deps/reports/decisions.md.`,
    });
  });
});
