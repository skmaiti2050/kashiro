import { useState } from 'react';
import { DEFAULT_DEPTH } from '@/engine/depth';
import { PRESETS } from '@/engine/presets';
import type { CheckSession } from '@/engine/session';
import { pickerVariants, proofreadingLabels } from './proofreadingLabels';
import type { Variant } from '@/engine/types';
import { DepthSlider } from './DepthSlider';
import { Dialog } from './Dialog';
import { ModulesSettings } from './ModulesSettings';
import { ReadingSettings } from './ReadingSettings';
import { SavedReviewsSettings } from './SavedReviewsSettings';
import { Tabs } from './Tabs';
import { WebStorageSettings } from './WebStorageSettings';
import { capabilities } from './platform/capabilities';
import type { ReadAloud } from './useReadAloud';
import { PRESET_KEYS, VARIANT_KEYS } from './Toolbar';
import type { UiLocale } from './i18n/catalogues';
import { LANGUAGE_NAMES, systemLanguage, UI_LANGUAGES, type UiLanguageSetting } from './i18n/locale';
import { useT } from './i18n/useT';
import { kindLabel } from './state/kindLabels';
import { readChoice, writeLocal } from './state/localMemory';
import { overwriteOffered } from './state/saveFlow';
import type { ControllerState, SessionController } from './state/sessionController';
import { AUTO_APPLY_KINDS, type Settings } from './state/settings';

/** The terms card's repeat count (the engine accepts 2–5). */
const TERM_REPEAT_CHOICES = [2, 3, 4, 5];

/** The pseudo-locale is offered only in development builds (layout testing). */
const LANGUAGES: UiLocale[] = import.meta.env.DEV ? [...UI_LANGUAGES, 'en-XA'] : UI_LANGUAGES;

/** Settings' tabs (F22 item 6 of the F21 list), one per group of today's sections. */
export const SETTINGS_TABS = ['reading', 'checking', 'saving', 'modules', 'language'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const TAB_KEYS = {
  reading: 'settings.tabReading',
  checking: 'settings.tabChecking',
  saving: 'settings.tabSaving',
  modules: 'settings.tabModules',
  language: 'settings.tabLanguage',
} as const;

/** Where the last tab is remembered: a per-PC convenience, not a setting, so it stays out of the settings file. */
const TAB_STORAGE_KEY = 'kashiro.settingsTab';

/** The tab Settings last showed; its first tab when none was saved or storage is off. */
const rememberedTab = (): SettingsTab => readChoice(TAB_STORAGE_KEY, SETTINGS_TABS, 'reading');

const rememberTab = (tab: SettingsTab): void => writeLocal(TAB_STORAGE_KEY, tab);

interface Props {
  controller: SessionController;
  state: ControllerState;
  /** Null when this PC has no local voice: Settings then says why read aloud is missing. */
  readAloud: ReadAloud | null;
  /** Settings › Checking's link to the Dictionary panel (it opens over Settings; Back returns here). */
  onOpenDictionary(): void;
  onClose(): void;
  /** The tab to open on (the command palette's "Settings: Reading", F23 item 6); the last one used by default. */
  initialTab?: SettingsTab;
}

export function SettingsPanel({ controller, state, readAloud, onOpenDictionary, onClose, initialTab }: Props) {
  const t = useT();
  const [tab, setTab] = useState<SettingsTab>(() => initialTab ?? rememberedTab());
  const { settings } = state;
  const choose = (next: SettingsTab) => {
    setTab(next);
    rememberTab(next);
  };

  return (
    <Dialog title={t.t('settings.title')} className="settings" onClose={onClose}>
      <Tabs label={t.t('settings.tabs')} tabs={SETTINGS_TABS.map((id) => ({ id, label: t.t(TAB_KEYS[id]) }))} selected={tab} onSelect={choose}>
        {tab === 'reading' && <ReadingSettings controller={controller} reading={settings.reading} readAloud={readAloud} />}
        {tab === 'checking' && <CheckingSettings controller={controller} settings={settings} session={state.session} onOpenDictionary={onOpenDictionary} />}
        {tab === 'saving' && <SavingSettings controller={controller} settings={settings} />}
        {tab === 'modules' && (
          <ModulesSettings controller={controller} settings={settings} checkingModel={state.checkingModel} helperBackend={state.helperBackend} />
        )}
        {tab === 'language' && <LanguageSettings controller={controller} settings={settings} session={state.session} />}
      </Tabs>
    </Dialog>
  );
}

interface SectionProps {
  controller: SessionController;
  settings: Settings;
}

function LanguageSettings({ controller, settings, session }: SectionProps & { session: CheckSession | null }) {
  const t = useT();
  const windowsLanguage = LANGUAGE_NAMES[systemLanguage(typeof navigator === 'undefined' ? [] : navigator.languages)];
  return (
    <>
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
      <p className="hint">{t.t(proofreadingLabels(session).hint)}</p>
    </>
  );
}

function SavingSettings({ controller, settings }: SectionProps) {
  const t = useT();
  return (
    <>
      <fieldset>
        <legend>{t.t('settings.saving')}</legend>
        <label>
          <input type="checkbox" checked={settings.saveMode === 'tracked'} onChange={(e) => controller.changeSettings({ saveMode: e.target.checked ? 'tracked' : 'clean' })} />
          {t.t('settings.trackedLabel')}
        </label>
        {/* A download can't replace anything (final review R2); a browser keeps no .bak (item 2). */}
        {overwriteOffered() && (
          <label>
            <input type="checkbox" checked={settings.overwrite} onChange={(e) => controller.changeSettings({ overwrite: e.target.checked })} />
            {capabilities.web ? t.t('settings.overwriteLabelWeb') : t.t('settings.overwriteLabel')}
          </label>
        )}
      </fieldset>
      <SavedReviewsSettings controller={controller} settings={settings} />
      {capabilities.web && <WebStorageSettings controller={controller} settings={settings} />}
    </>
  );
}

function CheckingSettings({ controller, settings, session, onOpenDictionary }: SectionProps & { session: CheckSession | null; onOpenDictionary(): void }) {
  const t = useT();
  const variants = pickerVariants(session);
  const setAutoApply = (kind: string, on: boolean) => {
    const tierOverrides = { ...settings.tierOverrides };
    if (on) tierOverrides[kind] = 'safe';
    else delete tierOverrides[kind];
    controller.changeSettings({ tierOverrides });
  };
  return (
    <>
      {variants.length > 0 && (
        <label className="field">
          <span>{t.t('settings.variant')}</span>
          <select value={settings.fallbackVariant} onChange={(e) => controller.changeSettings({ fallbackVariant: e.target.value as Variant })}>
            {variants.map((v) => (
              <option key={v} value={v}>
                {t.t(VARIANT_KEYS[v])}
              </option>
            ))}
          </select>
        </label>
      )}

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

      {/* The words themselves live in their own panel (F22 item 1). */}
      <p>
        <button className="link" onClick={onOpenDictionary}>
          {t.t('settings.openDictionary', { count: settings.dictionary.length })}
        </button>
      </p>
    </>
  );
}
