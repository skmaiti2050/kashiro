// Kinds of suggestion by a readable label, never the rule's own name (A1 carry-over for L1).
import { describe, it, expect } from 'vitest';
import { KIND_KEYS, kindLabel } from '@/ui/state/kindLabels';
import { en } from './english';

/** Harper 2.13's LintKind values plus the engine's own kinds. */
const KNOWN_KINDS = [
  'Agreement', 'BoundaryError', 'Capitalization', 'Eggcorn', 'Enhancement', 'Formatting', 'Grammar', 'Malapropism',
  'Miscellaneous', 'Nonstandard', 'Punctuation', 'Readability', 'Redundancy', 'Regionalism', 'Repetition', 'Spelling',
  'Style', 'Typo', 'Usage', 'WordChoice', 'WordOrder', 'Invisible', 'Variant', 'Contraction', 'Rewrite',
];

describe('kindLabel', () => {
  it('every known kind has a label with spaces, not a CamelCase rule name', () => {
    for (const kind of KNOWN_KINDS) expect(kindLabel(en, kind)).not.toMatch(/[a-z][A-Z]/);
    expect(Object.keys(KIND_KEYS).sort()).toEqual([...KNOWN_KINDS].sort());
  });

  it('readable names for the kinds whose own name says little', () => {
    expect(kindLabel(en, 'BoundaryError')).toBe('Words joined or split');
    expect(kindLabel(en, 'WordChoice')).toBe('Word choice');
  });

  it('a kind a newer Harper adds is called "Other"', () => {
    expect(kindLabel(en, 'SomethingNew')).toBe('Other');
  });
});
