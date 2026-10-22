import { useId } from 'react';
import { useT } from './i18n/useT';
import type { SessionController } from './state/sessionController';
import type { Settings } from './state/settings';

/** The retention choices in days; 0 keeps nothing. */
const RETENTION_CHOICES = [0, 7, 30, 90];

interface Props {
  controller: SessionController;
  settings: Settings;
}

/** Settings › Saved reviews: keep pasted text, how long reviews are kept, and Delete all. */
export function SavedReviewsSettings({ controller, settings }: Props) {
  const t = useT();
  const hintId = useId();
  const days = settings.sessionRetentionDays;
  // A value set by hand outside the list still shows as itself.
  const choices = RETENTION_CHOICES.includes(days) ? RETENTION_CHOICES : [...RETENTION_CHOICES, days].sort((a, b) => a - b);

  return (
    <fieldset aria-describedby={hintId}>
      <legend>{t.t('modules.savedSessions')}</legend>
      <p id={hintId} className="hint">
        {t.t('settings.savedReviewsHint')}
      </p>
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
        <button onClick={() => void controller.reviews.deleteAll()}>{t.t('settings.deleteReviews')}</button>
      </div>
    </fieldset>
  );
}
