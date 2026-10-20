import { describe, it, expect } from 'vitest';
import { defaultSettings, variantForLocale } from '@/ui/state/settings';

describe('variantForLocale', () => {
  it.each([
    ['en-US', 'American'],
    ['en-GB', 'British'],
    ['en-AU', 'Australian'],
    ['en-CA', 'Canadian'],
    ['en-IN', 'Indian'],
    ['hi-IN', 'Indian'],
    ['en', 'American'],
    ['fr-FR', 'American'],
  ])('%s → %s', (locale, variant) => {
    expect(variantForLocale(locale)).toBe(variant);
  });
});

describe('defaultSettings', () => {
  it('saves a tracked new copy by default, with an empty dictionary', () => {
    expect(defaultSettings('en-GB')).toEqual({
      preset: 'business',
      fallbackVariant: 'British',
      saveMode: 'tracked',
      overwrite: false,
      dictionary: [],
      tierOverrides: {},
      modelPath: null,
      depthByPreset: {},
    });
  });
});
