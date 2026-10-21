import { DEFAULT_DEPTH } from '@/engine/depth';
import { PRESETS } from '@/engine/presets';
import type { Variant } from '@/engine/types';
import { DepthSlider } from './DepthSlider';
import { VARIANTS } from './Toolbar';
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
  onClose(): void;
}

export function SettingsPanel({ controller, state, onClose }: Props) {
  const { settings } = state;
  const setAutoApply = (kind: string, on: boolean) => {
    const tierOverrides = { ...settings.tierOverrides };
    if (on) tierOverrides[kind] = 'safe';
    else delete tierOverrides[kind];
    controller.changeSettings({ tierOverrides });
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Settings</h2>
          <button className="quiet" onClick={onClose}>
            Close
          </button>
        </header>

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
            <DepthSlider
              key={p.id}
              label={p.label}
              value={settings.depthByPreset[p.id] ?? DEFAULT_DEPTH}
              onChange={(d) => controller.setDepth(d, p.id)}
            />
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
              {kind}
            </label>
          ))}
          <p className="hint">Never touches names, numbers, quotes or other protected text.</p>
        </fieldset>

        <fieldset>
          <legend>Ignored rules ({settings.ignoredRules.length})</legend>
          {settings.ignoredRules.length === 0 && <p className="hint">Rules you dismiss with “This rule everywhere” show up here.</p>}
          <ul className="dictionary">
            {settings.ignoredRules.map((rule) => (
              <li key={rule}>
                {rule}
                <button className="quiet" onClick={() => controller.restoreRule(rule)}>
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
                <button className="quiet" onClick={() => void controller.removeWord(word)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      </section>
    </div>
  );
}
