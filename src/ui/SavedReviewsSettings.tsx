import { useId, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { useT } from './i18n/useT';
import { capabilities } from './platform/capabilities';
import type { SessionController } from './state/sessionController';
import type { Settings } from './state/settings';

/** The retention choices in days; 0 keeps nothing. */
const RETENTION_CHOICES = [0, 7, 30, 90];

interface Props {
  controller: SessionController;
  settings: Settings;
}

/** Settings › Saved reviews: keep pasted text, how long reviews are kept, and Delete all (after a confirmation). */
export function SavedReviewsSettings({ controller, settings }: Props) {
  const t = useT();
  const hintId = useId();
  const [confirming, setConfirming] = useState(false);
  const days = settings.sessionRetentionDays;
  // A value set by hand outside the list still shows as itself.
  const choices = RETENTION_CHOICES.includes(days) ? RETENTION_CHOICES : [...RETENTION_CHOICES, days].sort((a, b) => a - b);

  return (
    <fieldset aria-describedby={capabilities.web ? undefined : hintId}>
      <legend>{t.t('modules.savedSessions')}</legend>
      {/* "In the app's own folder" isn't so on the web: its storage note (WebStorageSettings) says where they are. */}
      {!capabilities.web && (
        <p id={hintId} className="hint">
          {t.t('settings.savedReviewsHint')}
        </p>
      )}
      <label>
        <input type="checkbox" checked={settings.keepPastedText} onChange={(e) => void controller.reviews.setKeepPastedText(e.target.checked)} />
        {t.t('settings.keepPasted')}
      </label>
      <p className="hint">{t.t('settings.keepPastedHint')}</p>
      <label className="field">
        <span>{t.t('settings.retention')}</span>
        <select value={days} onChange={(e) => void controller.reviews.setRetention(Number(e.target.value))}>
          {choices.map((n) => (
            <option key={n} value={n}>
              {t.t('settings.retentionDays', { count: n })}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button onClick={() => setConfirming(true)}>{t.t('settings.deleteReviews')}</button>
      </div>
      {confirming && (
        <DeleteAllDialog
          onDelete={() => {
            setConfirming(false);
            void controller.reviews.deleteAll();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </fieldset>
  );
}

/** "Delete all saved reviews?": focus starts on Cancel, since deleting can't be undone. */
function DeleteAllDialog({ onDelete, onCancel }: { onDelete(): void; onCancel(): void }) {
  const t = useT();
  const cancelButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog title={t.t('reviews.deleteTitle')} role="alertdialog" describedBy="delete-reviews-text" initialFocus={cancelButton} onClose={onCancel}>
      <p id="delete-reviews-text">{t.t('reviews.deleteText')}</p>
      <div className="actions end">
        <button ref={cancelButton} onClick={onCancel}>
          {t.t('reviews.deleteCancel')}
        </button>
        <button className="primary" onClick={onDelete}>
          {t.t('reviews.deleteConfirm')}
        </button>
      </div>
    </Dialog>
  );
}
