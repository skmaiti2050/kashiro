import { PRESETS, type PresetId } from '@/engine/presets';
import type { Variant } from '@/engine/types';
import type { ControllerState, SessionController } from './state/sessionController';

export const VARIANTS: Variant[] = ['American', 'British', 'Australian', 'Canadian', 'Indian'];

interface Props {
  controller: SessionController;
  state: ControllerState;
  /** Open and Paste go through the app so unsaved work is offered a save first. */
  onOpen(): void;
  onPaste(): void;
  onSettings(): void;
  onHelp(): void;
}

/** Open · Paste · preset · variant chip · Save (with its save-mode menu) · Settings · Google Docs help. */
export function Toolbar({ controller, state, onOpen, onPaste, onSettings, onHelp }: Props) {
  const { session, settings, variantOverride, document } = state;

  return (
    <nav className="toolbar">
      <button onClick={onOpen}>Open</button>
      <button onClick={onPaste}>Paste</button>

      <label className="field">
        <span>Goal</span>
        <select value={settings.preset} onChange={(e) => controller.setPreset(e.target.value as PresetId)}>
          {Object.values(PRESETS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {session && (
        <label className={session.mixedVariant ? 'chip warn' : 'chip'} title={session.mixedVariant ? 'Some words follow another English variant; they are offered for review.' : undefined}>
          <span>{session.mixedVariant ? 'Mixed spelling' : 'English'}</span>
          <select
            value={variantOverride ?? ''}
            onChange={(e) => controller.setVariant(e.target.value === '' ? null : (e.target.value as Variant))}
          >
            <option value="">{session.variant} (detected)</option>
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}

      <span className="spacer" />
      <button className="quiet" onClick={onHelp}>
        Google Docs
      </button>
      <button className="quiet" onClick={onSettings}>
        Settings
      </button>

      <div className="save-group">
        <button className="primary" disabled={!document || !session} onClick={() => void controller.save()}>
          Save
        </button>
        <details className="save-menu">
          <summary aria-label="Save options">▾</summary>
          <div className="menu">
            <fieldset>
              <legend>Changes</legend>
              <label>
                <input type="radio" checked={settings.saveMode === 'tracked'} onChange={() => controller.changeSettings({ saveMode: 'tracked' })} />
                Tracked changes (default)
              </label>
              <label>
                <input type="radio" checked={settings.saveMode === 'clean'} onChange={() => controller.changeSettings({ saveMode: 'clean' })} />
                Clean
              </label>
            </fieldset>
            <fieldset>
              <legend>File</legend>
              <label>
                <input type="radio" checked={!settings.overwrite} onChange={() => controller.changeSettings({ overwrite: false })} />
                New copy (default)
              </label>
              <label>
                <input type="radio" checked={settings.overwrite} onChange={() => controller.changeSettings({ overwrite: true })} />
                Overwrite, with a backup
              </label>
            </fieldset>
          </div>
        </details>
      </div>
    </nav>
  );
}
