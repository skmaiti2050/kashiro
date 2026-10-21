import { PRESETS, type PresetId } from '@/engine/presets';
import type { Variant } from '@/engine/types';
import { siblingPath } from './state/documentText';
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
      <button onClick={onOpen} title="Open a .docx, .txt or .md file (Ctrl+O)" aria-keyshortcuts="Control+O">
        Open
      </button>
      <button onClick={onPaste} title="Paste text as a new document">
        Paste
      </button>

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
        <button
          className="primary"
          disabled={!document || !session}
          title={`Save: ${settings.saveMode === 'tracked' ? 'tracked changes' : 'clean copy'}, ${settings.overwrite ? 'overwrite (keeps a backup)' : 'new copy'}`}
          onClick={() => void controller.save()}
        >
          Save
        </button>
        <details className="save-menu">
          <summary aria-label="Save options">▾</summary>
          <div className="menu">
            <fieldset>
              <legend>How changes are saved</legend>
              <SaveChoice
                checked={settings.saveMode === 'tracked'}
                onChoose={() => controller.changeSettings({ saveMode: 'tracked' })}
                title="Tracked changes"
                detail="Your reviewer can accept or reject each change in Word. (.docx only: text files are always saved clean.)"
              />
              <SaveChoice
                checked={settings.saveMode === 'clean'}
                onChoose={() => controller.changeSettings({ saveMode: 'clean' })}
                title="Clean copy"
                detail="All accepted changes applied, no marks."
              />
            </fieldset>
            <fieldset>
              <legend>Where it goes</legend>
              <SaveChoice
                checked={!settings.overwrite}
                onChoose={() => controller.changeSettings({ overwrite: false })}
                title="New copy"
                detail={`Saved beside the original as ${checkedName(document?.name)}. The original is not touched.`}
              />
              <SaveChoice
                checked={settings.overwrite}
                onChoose={() => controller.changeSettings({ overwrite: true })}
                title="Overwrite (keeps a backup)"
                detail="Replaces the original after copying it to a .bak file. Pasted text is always saved as a new copy."
              />
            </fieldset>
          </div>
        </details>
      </div>
    </nav>
  );
}

/** "essay.docx" → "essay.checked.docx" (saveFlow's default name for a new copy). */
const checkedName = (name: string | undefined) => (name ? siblingPath(name, '.checked') : 'name.checked.docx');

function SaveChoice({ checked, onChoose, title, detail }: { checked: boolean; onChoose(): void; title: string; detail: string }) {
  return (
    <label className="save-choice">
      <input type="radio" checked={checked} onChange={onChoose} />
      <span>
        <strong>{title}</strong>
        <span className="hint">{detail}</span>
      </span>
    </label>
  );
}
