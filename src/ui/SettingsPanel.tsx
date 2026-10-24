import { DEFAULT_DEPTH } from '@/engine/depth';
import { PRESETS } from '@/engine/presets';
import type { Variant } from '@/engine/types';
import { DepthSlider } from './DepthSlider';
import { Dialog } from './Dialog';
import { ModulesSettings } from './ModulesSettings';
import { ReadingSettings } from './ReadingSettings';
import { SavedReviewsSettings } from './SavedReviewsSettings';
import type { ReadAloud } from './useReadAloud';
import { PRESET_KEYS, VARIANT_KEYS, VARIANTS } from './Toolbar';
import type { UiLocale } from './i18n/catalogues';
import { LANGUAGE_NAMES, systemLanguage, UI_LANGUAGES, type UiLanguageSetting } from './i18n/locale';
import { useT } from './i18n/useT';
import { kindLabel } from './state/kindLabels';
import type { ControllerState, SessionController } from './state/sessionController';
import { AUTO_APPLY_KINDS } from './state/settings';

/** The terms card's repeat count (the engine accepts 2–5). */
const TERM_REPEAT_CHOICES = [2, 3, 4, 5];

/** The pseudo-locale is offered only in development builds (layout testing). */
const LANGUAGES: UiLocale[] = import.meta.env.DEV ? [...UI_LANGUAGES, 'en-XA'] : UI_LANGUAGES;

interface Props {
  controller: SessionController;
  state: ControllerState;
  /** Null when this PC has no local voice: Settings then says why read aloud is missing. */
  readAloud: ReadAloud | null;
  onClose(): void;
}

export function SettingsPanel({ controller, state, readAloud, onClose }: Props) {
  const t = useT();
  const { settings } = state;
  const setAutoApply = (kind: string, on: boolean) => {
    const tierOverrides = { ...settings.tierOverrides };
    if (on) tierOverrides[kind] = 'safe';
    else delete tierOverrides[kind];
    controller.changeSettings({ tierOverrides });
  };
  const windowsLanguage = LANGUAGE_NAMES[systemLanguage(typeof navigator === 'undefined' ? [] : navigator.languages)];

  return (
    <Dialog title={t.t('settings.title')} className="settings" onClose={onClose}>
      <label className="field">
        <span>{t.t('language.label')}</span>
        <select value={settings.uiLanguage} onChange={(e) => controller.changeSettings({ uiLanguage: e.target.value as UiLanguageSetting })}>
          <option value="system">{t.t('language.system', { language: windowsLanguage })}</option>
          {LANGUAGES.map((language) => (
            // Each language in its own script, marked as such for screen readers.
            <option key={language} value={language} lang={language}>
              {LANGUAGE_NAMES[language]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{t.t('language.hint')}</p>

      <ReadingSettings controller={controller} reading={settings.reading} readAloud={readAloud} />

      <label className="field">
        <span>{t.t('settings.variant')}</span>
        <select value={settings.fallbackVariant} onChange={(e) => controller.changeSettings({ fallbackVariant: e.target.value as Variant })}>
          {VARIANTS.map((v) => (
            <option key={v} value={v}>
              {t.t(VARIANT_KEYS[v])}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>{t.t('settings.saving')}</legend>
        <label>
          <input type="checkbox" checked={settings.saveMode === 'tracked'} onChange={(e) => controller.changeSettings({ saveMode: e.target.checked ? 'tracked' : 'clean' })} />
          {t.t('settings.trackedLabel')}
        </label>
        <label>
          <input type="checkbox" checked={settings.overwrite} onChange={(e) => controller.changeSettings({ overwrite: e.target.checked })} />
          {t.t('settings.overwriteLabel')}
        </label>
      </fieldset>

      <fieldset>
        <legend>{t.t('settings.depth')}</legend>
        {Object.values(PRESETS).map((p) => (
          <DepthSlider key={p.id} label={t.t(PRESET_KEYS[p.id])} value={settings.depthByPreset[p.id] ?? DEFAULT_DEPTH} onChange={(d) => controller.setDepth(d, p.id)} />
        ))}
      </fieldset>

      <label className="field">
        <span>{t.t('settings.termRepeats')}</span>
        <select value={settings.termMinRepeats} onChange={(e) => controller.changeSettings({ termMinRepeats: Number(e.target.value) })}>
          {TERM_REPEAT_CHOICES.map((n) => (
            <option key={n} value={n}>
              {t.t('settings.times', { count: n })}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>{t.t('settings.autoApply')}</legend>
        {AUTO_APPLY_KINDS.map((kind) => (
          <label key={kind}>
            <input type="checkbox" checked={settings.tierOverrides[kind] === 'safe'} onChange={(e) => setAutoApply(kind, e.target.checked)} />
            {kindLabel(t, kind)}
          </label>
        ))}
        <p className="hint">{t.t('settings.autoApplyHint')}</p>
      </fieldset>

      <ModulesSettings controller={controller} settings={settings} checkingModel={state.checkingModel} helperBackend={state.helperBackend} />

      <SavedReviewsSettings controller={controller} settings={settings} />

      <fieldset>
        <legend>{t.t('settings.ignored', { count: settings.ignoredRules.length })}</legend>
        {settings.ignoredRules.length === 0 && <p className="hint">{t.t('settings.ignoredEmpty')}</p>}
        <ul className="dictionary">
          {settings.ignoredRules.map((rule) => (
            <li key={rule}>
              {kindLabel(t, rule)}
              <button className="quiet" aria-label={t.t('settings.restoreLabel', { kind: kindLabel(t, rule) })} onClick={() => controller.restoreRule(rule)}>
                {t.t('settings.restore')}
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend>{t.t('settings.dictionary', { count: settings.dictionary.length })}</legend>
        {settings.dictionary.length === 0 && <p className="hint">{t.t('settings.dictionaryEmpty')}</p>}
        <ul className="dictionary">
          {settings.dictionary.map((word) => (
            <li key={word}>
              <span lang="en">{word}</span>
              <button className="quiet" aria-label={t.t('settings.removeLabel', { word })} onClick={() => void controller.removeWord(word)}>
                {t.t('settings.remove')}
              </button>
            </li>
          ))}
        </ul>
      </fieldset>
    </Dialog>
  );
}
