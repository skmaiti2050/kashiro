import type { ReactNode } from 'react';
import type { ModuleSwitches } from '@/engine/modules';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';
import type { Settings } from './state/settings';
import type { SessionController } from './state/sessionController';
import { PRESET_KEYS } from './Toolbar';

interface ModuleInfo {
  name: keyof ModuleSwitches;
  label: MessageKey;
  description: MessageKey;
  /** Approximate size or memory cost (measured for U2: the dictionary's heap after parsing). */
  cost: MessageKey;
}

const MODULES: ModuleInfo[] = [
  { name: 'namesCard', label: 'modules.namesCard', description: 'modules.namesCardDescription', cost: 'modules.namesCardCost' },
  { name: 'termsCard', label: 'modules.termsCard', description: 'modules.termsCardDescription', cost: 'modules.termsCardCost' },
  { name: 'otherLanguageCard', label: 'modules.otherLanguageCard', description: 'modules.otherLanguageCardDescription', cost: 'modules.otherLanguageCardCost' },
  { name: 'betterSuggestions', label: 'modules.betterSuggestions', description: 'modules.betterSuggestionsDescription', cost: 'modules.betterSuggestionsCost' },
  { name: 'wordLookup', label: 'modules.wordLookup', description: 'modules.wordLookupDescription', cost: 'modules.wordLookupCost' },
  { name: 'aiRewrites', label: 'modules.aiRewrites', description: 'modules.aiRewritesDescription', cost: 'modules.aiRewritesCost' },
];

const strong = (chunks: ReactNode[]) => <strong>{chunks}</strong>;

interface Props {
  controller: SessionController;
  settings: Settings;
}

/** Settings › Modules: a switch per optional helper, for every goal or, when chosen, for the current goal only. */
export function ModulesSettings({ controller, settings }: Props) {
  const t = useT();
  const own = settings.modulesByPreset[settings.preset];
  const shown = own ?? settings.modules;
  const noModel = settings.modelPath === null;

  return (
    <fieldset>
      <legend>{t.t('modules.legend')}</legend>
      <label>
        <input type="checkbox" checked={own !== undefined} onChange={(e) => controller.useModulesForPreset(e.target.checked)} />
        {t.t('modules.perGoal', { goal: t.t(PRESET_KEYS[settings.preset]) })}
      </label>
      {MODULES.map((m) => {
        const locked = m.name === 'aiRewrites' && noModel;
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
              <span className="hint">{locked ? t.t('modules.needsModel') : t.t(m.cost)}</span>
            </span>
          </label>
        );
      })}
      <p className="hint">{t.t('modules.alwaysOn')}</p>
    </fieldset>
  );
}
