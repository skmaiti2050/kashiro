import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { PRESETS, type PresetId } from '@/engine/presets';
import type { Variant } from '@/engine/types';
import type { MessageKey } from './i18n/catalogues';
import type { Translator } from './i18n/translator';
import { useT } from './i18n/useT';
import { MoreMenu, type MoreMenuItem } from './MoreMenu';
import { siblingPath } from './state/documentText';
import { usePopup } from './usePopup';
import { middleTruncate } from './state/windowTitle';
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
  onDictionary(): void;
  onReportBug(): void;
  /** Opens the Releases page in the browser (F23 item 4); null hides the item (the web has no update check). */
  onCheckUpdates: (() => void) | null;
  onHelp(): void;
  onShortcuts(): void;
  onAbout(): void;
  /** Replays the welcome tour (F23 item 7). */
  onTour(): void;
  /** Close document (Ctrl+W), through the app's unsaved-changes guard. */
  onClose(): void;
  /** Look up the word at the cursor (Ctrl+D); null while word lookup is off. */
  onLookUp: (() => void) | null;
  /** "Improve this sentence" at the cursor; null hides the button (AI rewrites off, or nothing checked yet). */
  onImprove: (() => void) | null;
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

/**
 * Open · Paste · goal · English variant · Improve this sentence · ⋯ (Look up word, Close document, Google Docs,
 * Keyboard shortcuts, Settings, Dictionary, Report a bug, Check for updates, Welcome tour, About) · Save (with its save-mode menu).
 */
export function Toolbar({ controller, state, onOpen, onPaste, onSettings, onDictionary, onReportBug, onCheckUpdates, onHelp, onShortcuts, onAbout, onTour, onClose, onLookUp, onImprove }: Props) {
  const t = useT();
  const { session, settings, variantOverride, document } = state;
  const moreItems: MoreMenuItem[] = [
    ...(document && onLookUp ? [{ label: t.t('toolbar.lookUp'), keys: 'Ctrl+D', onChoose: onLookUp }] : []),
    ...(document ? [{ label: t.t('toolbar.close'), keys: 'Ctrl+W', onChoose: onClose }] : []),
    { label: t.t('toolbar.googleDocs'), onChoose: onHelp },
    { label: t.t('toolbar.shortcuts'), keys: 'F1', onChoose: onShortcuts },
    { label: t.t('toolbar.settings'), keys: 'Ctrl+,', onChoose: onSettings },
    { label: t.t('toolbar.dictionary'), onChoose: onDictionary },
    { label: t.t('toolbar.reportBug'), onChoose: onReportBug },
    ...(onCheckUpdates ? [{ label: t.t('toolbar.checkUpdates'), onChoose: onCheckUpdates }] : []),
    { label: t.t('toolbar.tour'), onChoose: onTour },
    { label: t.t('toolbar.about'), onChoose: onAbout },
  ];
  // Save ▾ is a <details> whose open state React holds, so usePopup can place it and close it (Task F20 item 7).
  const [saveOpen, setSaveOpen] = useState(false);
  const saveGroup = useRef<HTMLDivElement>(null);
  const saveMenu = useRef<HTMLDivElement>(null);
  const saveSummary = useRef<HTMLElement>(null);
  const closeSave = useCallback(() => setSaveOpen(false), []);
  const savePlacement = usePopup({ open: saveOpen, close: closeSave, anchor: saveGroup, menu: saveMenu, prefer: 'start' });
  const closeSaveMenu = (e: KeyboardEvent<HTMLDetailsElement>) => {
    if (e.key !== 'Escape' || !saveOpen) return;
    e.stopPropagation();
    setSaveOpen(false);
    saveSummary.current?.focus();
  };

  return (
    <div className="toolbar" role="toolbar" aria-label={t.t('toolbar.label')} onKeyDown={(e) => moveAlongToolbar(e, t.dir)}>
      <button onClick={onOpen} title={t.t('toolbar.openTitle')} aria-keyshortcuts="Control+O">
        {t.t('toolbar.open')}
      </button>
      <button onClick={onPaste} title={t.t('toolbar.pasteTitle')}>
        {t.t('toolbar.paste')}
      </button>

      {/* Goal, the variant and Improve: in a short window they scroll sideways before the toolbar takes a row (F27 item 2). */}
      <div className="toolbar-secondary">
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
              <option value="">{automaticVariantLabel(t, variantOverride, session.variant, session.variantFromFallback)}</option>
              {VARIANTS.map((v) => (
                <option key={v} value={v}>
                  {t.t(VARIANT_KEYS[v])}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* In the strip too: with AI on it was the third row. Ctrl+I reaches it wherever the strip is scrolled. */}
        {onImprove && (
          <button onClick={onImprove} aria-keyshortcuts="Control+I" title={t.t('ai.improveTitle')}>
            {t.t('ai.improve')}
          </button>
        )}
      </div>

      <span className="spacer" />
      {/* The opened file's name, as the window title has it, in full on hover (F20 item 11). */}
      {document?.path && (
        <span className="doc-name" title={document.name}>
          {middleTruncate(document.name)}
        </span>
      )}
      <MoreMenu items={moreItems} />

      <div className="save-group" ref={saveGroup}>
        <button
          className="primary"
          disabled={!document || !session}
          title={t.t('save.title', { mode: settings.saveMode, overwrite: settings.overwrite ? 'yes' : 'no' })}
          onClick={() => void controller.save()}
        >
          {t.t('save.button')}
        </button>
        <details className="save-menu" open={saveOpen} onKeyDown={closeSaveMenu}>
          <summary
            ref={saveSummary}
            aria-label={t.t('save.options')}
            onClick={(e) => {
              e.preventDefault();
              setSaveOpen((v) => !v);
            }}
          >
            ▾
          </summary>
          <div className="menu" ref={saveMenu} style={savePlacement}>
            <fieldset>
              <legend>{t.t('save.howLegend')}</legend>
              <SaveChoice
                checked={settings.saveMode === 'tracked'}
                onChoose={() => controller.changeSettings({ saveMode: 'tracked' })}
                title={t.t('save.tracked')}
                detail={t.t('save.trackedDetail')}
                tip={t.t('save.trackedWordTip')}
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

/**
 * The variant menu's first choice, which clears the user's pick. While a variant is picked the check has detected
 * nothing, so it names none: "American (detected)" there was the pick itself, and choosing it fell back to
 * "Indian (default)" (F20 item 5). With no pick it names the variant the check chose and why.
 */
function automaticVariantLabel(t: Translator, picked: Variant | null, variant: Variant, fromFallback: boolean): string {
  if (picked !== null) return t.t('toolbar.automatic');
  return t.t(fromFallback ? 'toolbar.default' : 'toolbar.detected', { variant: t.t(VARIANT_KEYS[variant]) });
}

/** "essay.docx" → "essay.checked.docx" (saveFlow's default name for a new copy). */
const checkedName = (name: string | undefined) => (name ? siblingPath(name, '.checked') : 'name.checked.docx');

function SaveChoice({ checked, onChoose, title, detail, tip }: { checked: boolean; onChoose(): void; title: string; detail: string; tip?: string }) {
  return (
    <label className="save-choice">
      <input type="radio" checked={checked} onChange={onChoose} />
      <span>
        <strong>{title}</strong>
        <span className="hint">{detail}</span>
        {tip && <span className="hint">{tip}</span>}
      </span>
    </label>
  );
}
