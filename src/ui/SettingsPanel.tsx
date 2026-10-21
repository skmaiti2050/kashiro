import { DEFAULT_DEPTH } from '@/engine/depth';
import { PRESETS } from '@/engine/presets';
import type { Variant } from '@/engine/types';
import { DepthSlider } from './DepthSlider';
import { Dialog } from './Dialog';
import { ModulesSettings } from './ModulesSettings';
import { ReadingSettings } from './ReadingSettings';
import type { ReadAloud } from './useReadAloud';
import { VARIANTS } from './Toolbar';
import { kindLabel } from './state/kindLabels';
import type { ControllerState, SessionController } from './state/sessionController';

/**
 * Kinds the user may move to auto-apply (spec §5). LLM rewrites and fact-locked spans are never offered
 * (the engine keeps them in review whatever the setting), and neither is Variant: the app never converts
 * between English variants on its own.
 */
const AUTO_APPLY_KINDS = ['Agreement', 'Grammar', 'Usage', 'WordChoice', 'Redundancy', 'Style', 'Readability', 'Contraction'];

/** The terms card's repeat count (the engine accepts 2–5). */
const TERM_REPEAT_CHOICES = [2, 3, 4, 5];

interface Props {
  controller: SessionController;
  state: ControllerState;
  /** Null when this PC has no local voice: Settings then says why read aloud is missing. */
  readAloud: ReadAloud | null;
  onClose(): void;
}

export function SettingsPanel({ controller, state, readAloud, onClose }: Props) {
  const { settings } = state;
  const setAutoApply = (kind: string, on: boolean) => {
    const tierOverrides = { ...settings.tierOverrides };
    if (on) tierOverrides[kind] = 'safe';
    else delete tierOverrides[kind];
    controller.changeSettings({ tierOverrides });
  };

  return (
    <Dialog title="Settings" className="settings" onClose={onClose}>
      <ReadingSettings controller={controller} reading={settings.reading} readAloud={readAloud} />

      <label className="field">
        <span>Default English variant</span>
        <select value={settings.fallbackVariant} onChange={(e) => controller.changeSettings({ fallbackVariant: e.target.value as Variant })}>
          {VARIANTS.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Saving</legend>
        <label>
          <input type="checkbox" checked={settings.saveMode === 'tracked'} onChange={(e) => controller.changeSettings({ saveMode: e.target.checked ? 'tracked' : 'clean' })} />
          Tracked changes: your reviewer can accept or reject each change in Word (otherwise a clean copy)
        </label>
        <label>
          <input type="checkbox" checked={settings.overwrite} onChange={(e) => controller.changeSettings({ overwrite: e.target.checked })} />
          Overwrite the original (keeps a .bak backup) instead of saving a new copy
        </label>
      </fieldset>

      <fieldset>
        <legend>Review depth</legend>
        {Object.values(PRESETS).map((p) => (
          <DepthSlider key={p.id} label={p.label} value={settings.depthByPreset[p.id] ?? DEFAULT_DEPTH} onChange={(d) => controller.setDepth(d, p.id)} />
        ))}
      </fieldset>

      <label className="field">
        <span>Treat an unknown lowercase word as a term once it is used</span>
        <select value={settings.termMinRepeats} onChange={(e) => controller.changeSettings({ termMinRepeats: Number(e.target.value) })}>
          {TERM_REPEAT_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n} times
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Auto-apply these too</legend>
        {AUTO_APPLY_KINDS.map((kind) => (
          <label key={kind}>
            <input type="checkbox" checked={settings.tierOverrides[kind] === 'safe'} onChange={(e) => setAutoApply(kind, e.target.checked)} />
            {kindLabel(kind)}
          </label>
        ))}
        <p className="hint">Never touches names, numbers, quotes or other protected text.</p>
      </fieldset>

      <ModulesSettings controller={controller} settings={settings} />

      <fieldset>
        <legend>Ignored rules ({settings.ignoredRules.length})</legend>
        {settings.ignoredRules.length === 0 && <p className="hint">Kinds of suggestion you dismiss with Dismiss ▾ › “All … suggestions everywhere” show up here.</p>}
        <ul className="dictionary">
          {settings.ignoredRules.map((rule) => (
            <li key={rule}>
              {kindLabel(rule)}
              <button className="quiet" aria-label={`Restore ${kindLabel(rule)}`} onClick={() => controller.restoreRule(rule)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend>My dictionary ({settings.dictionary.length})</legend>
        {settings.dictionary.length === 0 && <p className="hint">Words you add while reviewing show up here.</p>}
        <ul className="dictionary">
          {settings.dictionary.map((word) => (
            <li key={word}>
              {word}
              <button className="quiet" aria-label={`Remove ${word}`} onClick={() => void controller.removeWord(word)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </fieldset>
    </Dialog>
  );
}
