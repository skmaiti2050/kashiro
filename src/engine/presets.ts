export type PresetId = 'academic' | 'blog' | 'script' | 'business';

export interface Preset {
  id: PresetId;
  label: string;
  /** Candidate kinds never shown under this preset. */
  hiddenKinds: string[];
  /** Kinds this preset treats as style: never auto-applied, always reviewed. */
  reviewKinds: string[];
  /** Extra preset-only checks the caller runs (e.g. `findContractions`). */
  extraRules: 'contractions'[];
}

// Harper 2.13 has no sentence-fragment lint ("Big news. Huge." and "Because reasons."
// produce nothing), so `script` has nothing extra to hide for fragments.
export const PRESETS: Record<PresetId, Preset> = {
  academic: {
    id: 'academic',
    label: 'Academic',
    hiddenKinds: [],
    reviewKinds: ['Style', 'Readability', 'Contraction'],
    extraRules: ['contractions'],
  },
  blog: {
    id: 'blog',
    label: 'Blog',
    hiddenKinds: ['Enhancement'],
    reviewKinds: ['Style', 'Readability'],
    extraRules: [],
  },
  script: {
    id: 'script',
    label: 'Script',
    hiddenKinds: ['Style', 'Readability', 'Enhancement'],
    reviewKinds: [],
    extraRules: [],
  },
  business: {
    id: 'business',
    label: 'Business',
    hiddenKinds: [],
    reviewKinds: ['Style', 'Readability'],
    extraRules: [],
  },
};
