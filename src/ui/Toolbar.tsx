import { useRef, type KeyboardEvent } from 'react';
import { PRESETS, type PresetId } from '@/engine/presets';
import type { Variant } from '@/engine/types';
import type { MessageKey } from './i18n/catalogues';
import { useT } from './i18n/useT';
import { siblingPath } from './state/documentText';
import type { ControllerState, SessionController } from './state/sessionController';

export const VARIANTS: Variant[] = ['American', 'British', 'Australian', 'Canadian', 'Indian'];

/** Each English variant's name in the UI language. */
export const VARIANT_KEYS: Record<Variant, MessageKey> = {
  American: 'variant.American',
  British: 'variant.British',
  Australian: 'variant.Australian',
  Canadian: 'variant.Canadian',
  Indian: 'variant.Indian',
};

/** Each goal's name in the UI language. */
export const PRESET_KEYS: Record<PresetId, MessageKey> = {
  academic: 'preset.academic',
  blog: 'preset.blog',
  script: 'preset.script',
  business: 'preset.business',
};

interface Props {
  controller: SessionController;
  state: ControllerState;
  /** Open and Paste go through the app so unsaved work is offered a save first. */
  onOpen(): void;
  onPaste(): void;
  onSettings(): void;
  onHelp(): void;
  onShortcuts(): void;
  onAbout(): void;
}

/** Toolbar items the arrow keys move between (a select keeps its arrows: they change its value). */
const ARROW_ITEMS = 'button:not(:disabled), select, summary';

/**
 * Left / Right move along the toolbar (Tab still reaches every item, so nothing depends on the arrows).
 * Skipped inside a select or an open menu, whose arrows have their own job. In a right-to-left language
 * the arrows follow the reading direction.
 */
function moveAlongToolbar(e: KeyboardEvent<HTMLElement>, dir: 'ltr' | 'rtl'): void {
  if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey) return;
  const from = e.target as HTMLElement;
  if (from.tagName === 'SELECT' || from.closest('.menu')) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('*')].filter((el) => el.matches(ARROW_ITEMS) && !el.closest('.menu'));
  const at = items.indexOf(from);
  if (at === -1) return;
  e.preventDefault();
  const forward = (e.key === 'ArrowRight') === (dir === 'ltr');
  items[(at + (forward ? 1 : -1) + items.length) % items.length].focus();
}

/** Open · Paste · preset · variant chip · Google Docs help · Shortcuts · Settings · About · Save (with its save-mode menu). */
export function Toolbar({ controller, state, onOpen, onPaste, onSettings, onHelp, onShortcuts, onAbout }: Props) {
  const t = useT();
  const { session, settings, variantOverride, document } = state;
  const saveMenu = useRef<HTMLDetailsElement>(null);
  const closeSaveMenu = (e: KeyboardEvent<HTMLDetailsElement>) => {
    if (e.key !== 'Escape' || !saveMenu.current?.open) return;
    e.stopPropagation();
    saveMenu.current.open = false;
    saveMenu.current.querySelector('summary')?.focus();
  };

  return (
    <div className="toolbar" role="toolbar" aria-label={t.t('toolbar.label')} onKeyDown={(e) => moveAlongToolbar(e, t.dir)}>
      <button onClick={onOpen} title={t.t('toolbar.openTitle')} aria-keyshortcuts="Control+O">
        {t.t('toolbar.open')}
      </button>
      <button onClick={onPaste} title={t.t('toolbar.pasteTitle')}>
        {t.t('toolbar.paste')}
      </button>

      <label className="field">
        <span>{t.t('toolbar.goal')}</span>
        <select value={settings.preset} onChange={(e) => controller.setPreset(e.target.value as PresetId)}>
          {Object.values(PRESETS).map((p) => (
            <option key={p.id} value={p.id}>
              {t.t(PRESET_KEYS[p.id])}
            </option>
          ))}
        </select>
      </label>

      {session && (
        <label className={session.mixedVariant ? 'chip warn' : 'chip'} title={session.mixedVariant ? t.t('toolbar.mixedTitle') : undefined}>
          <span>{session.mixedVariant ? t.t('toolbar.mixedSpelling') : t.t('toolbar.english')}</span>
          <select
            value={variantOverride ?? ''}
            onChange={(e) => controller.setVariant(e.target.value === '' ? null : (e.target.value as Variant))}
          >
            <option value="">{t.t('toolbar.detected', { variant: t.t(VARIANT_KEYS[session.variant]) })}</option>
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {t.t(VARIANT_KEYS[v])}
              </option>
            ))}
          </select>
        </label>
      )}

      <span className="spacer" />
      <button className="quiet" onClick={onHelp}>
        {t.t('toolbar.googleDocs')}
      </button>
      <button className="quiet" aria-keyshortcuts="F1" title={t.t('toolbar.shortcutsTitle')} onClick={onShortcuts}>
        {t.t('toolbar.shortcuts')}
      </button>
      <button className="quiet" aria-keyshortcuts="Control+Comma" title={t.t('toolbar.settingsTitle')} onClick={onSettings}>
        {t.t('toolbar.settings')}
      </button>
      <button className="quiet" title={t.t('toolbar.aboutTitle')} onClick={onAbout}>
        {t.t('toolbar.about')}
      </button>

      <div className="save-group">
        <button
          className="primary"
          disabled={!document || !session}
          title={t.t('save.title', { mode: settings.saveMode, overwrite: settings.overwrite ? 'yes' : 'no' })}
          onClick={() => void controller.save()}
        >
          {t.t('save.button')}
        </button>
        <details className="save-menu" ref={saveMenu} onKeyDown={closeSaveMenu}>
          <summary aria-label={t.t('save.options')}>▾</summary>
          <div className="menu">
            <fieldset>
              <legend>{t.t('save.howLegend')}</legend>
              <SaveChoice
                checked={settings.saveMode === 'tracked'}
                onChoose={() => controller.changeSettings({ saveMode: 'tracked' })}
                title={t.t('save.tracked')}
                detail={t.t('save.trackedDetail')}
              />
              <SaveChoice
                checked={settings.saveMode === 'clean'}
                onChoose={() => controller.changeSettings({ saveMode: 'clean' })}
                title={t.t('save.clean')}
                detail={t.t('save.cleanDetail')}
              />
            </fieldset>
            <fieldset>
              <legend>{t.t('save.whereLegend')}</legend>
              <SaveChoice
                checked={!settings.overwrite}
                onChoose={() => controller.changeSettings({ overwrite: false })}
                title={t.t('save.newCopy')}
                detail={t.t('save.newCopyDetail', { name: checkedName(document?.name) })}
              />
              <SaveChoice
                checked={settings.overwrite}
                onChoose={() => controller.changeSettings({ overwrite: true })}
                title={t.t('save.overwrite')}
                detail={t.t('save.overwriteDetail')}
              />
            </fieldset>
          </div>
        </details>
      </div>
    </div>
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
