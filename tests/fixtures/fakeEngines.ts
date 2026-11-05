import type { EngineId, LanguageEngine } from '@/engine/languageEngine';
import type { Candidate, Paragraph } from '@/engine/types';

interface FakeEngineOptions {
  /** The engine id; a test that asserts one passes it. */
  id?: string;
  /** The candidates it finds: a fixed list, or a function of the paragraphs it is given. */
  found?: Candidate[] | ((paras: Paragraph[]) => Candidate[]);
  /** The paragraph ids it reports as not checked. */
  unchecked?: number[];
  /** Pushed one list of paragraph ids per check, to see what the engine was given. */
  seen?: number[][];
}

/** A fake proofreading engine for a script Kashiro has no real engine for yet. */
export function fakeEngine({ id = 'fake-hi', found = [], unchecked = [], seen }: FakeEngineOptions = {}): LanguageEngine {
  return {
    capabilities: {
      id: id as EngineId,
      proofreads: true,
      variants: [],
      hasCase: false,
      script: 'Devanagari',
      language: 'hi',
      trust: { zeroClick: true, safeKinds: 'layoutOnly', ticks: 'none' },
    },
    check: async (paras) => {
      seen?.push(paras.map((p) => p.id));
      return { found: typeof found === 'function' ? found(paras) : found, uncheckedParagraphs: unchecked };
    },
    addWords: async () => {},
  };
}

/** `scriptEngines` for a session or controller: `engine` proofreads Devanagari. */
export function devanagariEngines(engine: LanguageEngine): ReadonlyMap<string, LanguageEngine> {
  return new Map([['Devanagari', engine]]);
}
