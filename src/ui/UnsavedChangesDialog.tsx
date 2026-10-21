import { useRef, useState } from 'react';
import { Dialog } from './Dialog';

interface Props {
  name: string;
  /** Saves the document; resolves true when it was written (false: cancelled or failed). */
  onSave(): Promise<boolean>;
  onDiscard(): void;
  onCancel(): void;
}

/** "Save, Discard, or Cancel?" before something would drop the open document's unsaved work. Escape cancels. */
export function UnsavedChangesDialog({ name, onSave, onDiscard, onCancel }: Props) {
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
    <Dialog title="Unsaved changes" role="alertdialog" className="unsaved" describedBy="unsaved-text" initialFocus={saveButton} onClose={onCancel}>
      <p id="unsaved-text">
        You have unsaved changes in <b>{name}</b>. Save, Discard, or Cancel?
      </p>
      <div className="actions end">
        <button className="quiet" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button onClick={onDiscard} disabled={saving}>
          Discard
        </button>
        <button ref={saveButton} className="primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}
