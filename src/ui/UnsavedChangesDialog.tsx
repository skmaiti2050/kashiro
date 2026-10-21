import { useRef, useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { useT } from './i18n/useT';

interface Props {
  name: string;
  /** Saves the document; resolves true when it was written (false: cancelled or failed). */
  onSave(): Promise<boolean>;
  onDiscard(): void;
  onCancel(): void;
}

const bold = (chunks: ReactNode[]) => <b>{chunks}</b>;

/** "Save, Discard, or Cancel?" before something would drop the open document's unsaved work. Escape cancels. */
export function UnsavedChangesDialog({ name, onSave, onDiscard, onCancel }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const saveButton = useRef<HTMLButtonElement>(null);

  const save = async () => {
    setSaving(true);
    let saved = false;
    try {
      saved = await onSave();
    } finally {
      setSaving(false);
    }
    if (saved) onDiscard(); // the work is safe on disk: go on with what was asked
  };

  return (
    <Dialog title={t.t('unsaved.title')} role="alertdialog" className="unsaved" describedBy="unsaved-text" initialFocus={saveButton} onClose={onCancel}>
      <p id="unsaved-text">{t.rich('unsaved.text', { name, b: bold })}</p>
      <div className="actions end">
        <button className="quiet" onClick={onCancel} disabled={saving}>
          {t.t('unsaved.cancel')}
        </button>
        <button onClick={onDiscard} disabled={saving}>
          {t.t('unsaved.discard')}
        </button>
        <button ref={saveButton} className="primary" onClick={() => void save()} disabled={saving}>
          {saving ? t.t('unsaved.saving') : t.t('unsaved.save')}
        </button>
      </div>
    </Dialog>
  );
}
