import type { ModuleSwitches } from '@/engine/modules';
import { PRESETS } from '@/engine/presets';
import type { Settings } from './state/settings';
import type { SessionController } from './state/sessionController';

interface ModuleInfo {
  name: keyof ModuleSwitches;
  label: string;
  description: string;
  /** Approximate size or memory cost (measured for U2: the dictionary heap after parsing, the model's count tables). */
  cost: string;
}

const MODULES: ModuleInfo[] = [
  { name: 'namesCard', label: 'Names card', description: 'Groups names and places into one card you add in one go.', cost: 'No extra data.' },
  { name: 'termsCard', label: 'Terms card', description: 'Groups words you repeat (“ferrocement”) into one card.', cost: 'No extra data.' },
  {
    name: 'otherLanguageCard',
    label: 'Indian-language words card',
    description: 'Recognises romanised Hindi, Bengali, Tamil and other Indian-language words, and keeps them from being “fixed”.',
    cost: 'About 30 MB of memory while loaded, only for documents with unknown lowercase words.',
  },
  {
    name: 'betterSuggestions',
    label: 'Better spelling suggestions',
    description: 'Puts the likeliest word first and adds common words the spell checker missed.',
    cost: 'Uses the word list the app always has: no extra memory.',
  },
  {
    name: 'wordLookup',
    label: 'Word lookup',
    description: 'Meanings and synonyms from an offline dictionary.',
    cost: 'About 60 MB of memory once you look up a word (3.5 MB of data).',
  },
  {
    name: 'aiRewrites',
    label: 'AI rewrites',
    description: 'A writing helper on this computer suggests smoother sentences. Never applied without your click.',
    cost: 'A 1–3 GB model, and as much memory while it runs.',
  },
];

interface Props {
  controller: SessionController;
  settings: Settings;
}

/** Settings › Modules: a switch per optional helper, for every goal or, when chosen, for the current goal only. */
export function ModulesSettings({ controller, settings }: Props) {
  const own = settings.modulesByPreset[settings.preset];
  const shown = own ?? settings.modules;
  const noModel = settings.modelPath === null;

  return (
    <fieldset>
      <legend>Modules</legend>
      <label>
        <input type="checkbox" checked={own !== undefined} onChange={(e) => controller.useModulesForPreset(e.target.checked)} />
        Use different modules for the {PRESETS[settings.preset].label} goal
      </label>
      {MODULES.map((m) => {
        const locked = m.name === 'aiRewrites' && noModel;
        return (
          <label key={m.name} className="module-switch">
            <input type="checkbox" checked={shown[m.name] && !locked} disabled={locked} onChange={(e) => controller.setModule(m.name, e.target.checked)} />
            <span>
              <strong>{m.label}</strong>: {m.description}
              <br />
              <span className="hint">{locked ? 'Needs the writing model, which is not downloaded yet.' : m.cost}</span>
            </span>
          </label>
        );
      })}
      <p className="hint">Spelling and grammar rules, and the protection of names, numbers, quotes and code, are always on.</p>
    </fieldset>
  );
}
