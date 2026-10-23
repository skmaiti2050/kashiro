import type { ReactNode } from 'react';
import type { ModuleSwitches } from '@/engine/modules';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';
import { ModelFile } from './ModelFile';
import type { HelperBackend } from './state/optionalModules';
import type { Settings } from './state/settings';
import type { SessionController } from './state/sessionController';
import { PRESET_KEYS } from './Toolbar';

interface ModuleInfo {
  name: keyof ModuleSwitches;
  label: MessageKey;
  description: MessageKey;
  /** Approximate size or memory cost (measured for U2: the dictionary's heap after parsing). */
  cost: MessageKey;
  /** The cost's numbers, formatted in the UI language (megabytes, gigabytes). */
  costValues?: Record<string, number>;
}

const MODULES: ModuleInfo[] = [
  { name: 'namesCard', label: 'modules.namesCard', description: 'modules.namesCardDescription', cost: 'modules.namesCardCost' },
  { name: 'termsCard', label: 'modules.termsCard', description: 'modules.termsCardDescription', cost: 'modules.termsCardCost' },
  { name: 'otherLanguageCard', label: 'modules.otherLanguageCard', description: 'modules.otherLanguageCardDescription', cost: 'modules.otherLanguageCardCost' },
  { name: 'betterSuggestions', label: 'modules.betterSuggestions', description: 'modules.betterSuggestionsDescription', cost: 'modules.betterSuggestionsCost' },
  { name: 'savedSessions', label: 'modules.savedSessions', description: 'modules.savedSessionsDescription', cost: 'modules.savedSessionsCost' },
  { name: 'wordLookup', label: 'modules.wordLookup', description: 'modules.wordLookupDescription', cost: 'modules.wordLookupCost', costValues: { memory: 60, data: 3.5 } },
  {
    name: 'aiRewrites',
    label: 'modules.aiRewrites',
    description: 'modules.aiRewritesDescription',
    cost: 'modules.aiRewritesCost',
    costValues: { min: 1, max: 3 },
  },
];

const strong = (chunks: ReactNode[]) => <strong>{chunks}</strong>;

interface Props {
  controller: SessionController;
  settings: Settings;
  /** The chosen model file is being hashed. */
  checkingModel: boolean;
  /** The build running the writing helper, or null. */
  helperBackend: HelperBackend | null;
}

/**
 * Settings › Modules: a switch per optional helper, for every goal or, when chosen, for the current goal only,
 * and the writing helper's model file.
 */
export function ModulesSettings({ controller, settings, checkingModel, helperBackend }: Props) {
  const t = useT();
  const own = settings.modulesByPreset[settings.preset];
  const shown = own ?? settings.modules;
  const noModel = settings.modelPath === null;
  // The version without the AI helper: the switch shows, off and locked, with a note instead of the model file.
  const notInstalled = !controller.helperInstalled;
  const aiHint = notInstalled ? t.t('modules.aiNotInstalled') : t.t('modules.needsModel');

  return (
    <fieldset>
      <legend>{t.t('modules.legend')}</legend>
      <label>
        <input type="checkbox" checked={own !== undefined} onChange={(e) => controller.useModulesForPreset(e.target.checked)} />
        {t.t('modules.perGoal', { goal: t.t(PRESET_KEYS[settings.preset]) })}
      </label>
      {MODULES.map((m) => {
        const locked = m.name === 'aiRewrites' && (noModel || notInstalled);
        return (
          <label key={m.name} className="module-switch">
            <input
              type="checkbox"
              role="switch"
              checked={shown[m.name] && !locked}
              disabled={locked}
              onChange={(e) => controller.setModule(m.name, e.target.checked)}
            />
            <span>
              {t.rich('modules.switch', { label: t.t(m.label), description: t.t(m.description), b: strong })}
              <br />
              <span className="hint">{locked ? aiHint : t.t(m.cost, m.costValues)}</span>
            </span>
          </label>
        );
      })}
      {!notInstalled && <ModelFile controller={controller} settings={settings} checking={checkingModel} backend={helperBackend} />}
      <p className="hint">{t.t('modules.alwaysOn')}</p>
    </fieldset>
  );
}
