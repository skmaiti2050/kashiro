import { describe, it, expect } from 'vitest';
import { DEFAULT_MODULES } from '@/engine/modules';
import { defaultSettings, modulesFor, variantForLocale, withSavedSettings, type Settings } from '@/ui/state/settings';

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
      termMinRepeats: 3,
      ignoredRules: [],
      modules: DEFAULT_MODULES,
      modulesByPreset: {},
    });
  });
});

describe('withSavedSettings', () => {
  const defaults = defaultSettings('en-IN');

  it('nothing saved: the defaults', () => {
    expect(withSavedSettings(defaults, undefined)).toEqual(defaults);
  });

  it('settings saved before modules existed get the default modules', () => {
    const saved: Partial<Settings> = { preset: 'blog', dictionary: ['Sujit'] };
    expect(withSavedSettings(defaults, saved)).toEqual({ ...defaults, preset: 'blog', dictionary: ['Sujit'] });
  });

  it('saved switches are kept; a module added later gets its default; unknown keys are dropped', () => {
    const saved = {
      modules: { termsCard: false, factLock: false },
      modulesByPreset: { academic: { namesCard: false } },
    } as unknown as Partial<Settings>;
    const settings = withSavedSettings(defaults, saved);
    expect(settings.modules).toEqual({ ...DEFAULT_MODULES, termsCard: false });
    expect(settings.modulesByPreset).toEqual({ academic: { ...DEFAULT_MODULES, namesCard: false } });
  });
});

describe('modulesFor', () => {
  const base = defaultSettings('en-US');

  it('a goal without its own switches uses the shared ones', () => {
    const settings: Settings = { ...base, preset: 'blog', modules: { ...DEFAULT_MODULES, termsCard: false } };
    expect(modulesFor(settings)).toEqual({ ...DEFAULT_MODULES, termsCard: false });
  });

  it('a goal with its own switches ("Use different modules for this goal") uses them', () => {
    const settings: Settings = {
      ...base,
      preset: 'academic',
      modules: { ...DEFAULT_MODULES, termsCard: false },
      modulesByPreset: { academic: { ...DEFAULT_MODULES, namesCard: false } },
    };
    expect(modulesFor(settings)).toEqual({ ...DEFAULT_MODULES, namesCard: false });
    expect(modulesFor(settings, 'blog')).toEqual({ ...DEFAULT_MODULES, termsCard: false });
  });

  it('AI rewrites stay off until a model is downloaded, whatever the switch says', () => {
    const on: Settings = { ...base, modules: { ...DEFAULT_MODULES, aiRewrites: true } };
    expect(modulesFor(on).aiRewrites).toBe(false);
    expect(modulesFor({ ...on, modelPath: 'models/helper.gguf' }).aiRewrites).toBe(true);
  });
});
