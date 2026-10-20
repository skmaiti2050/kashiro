import { useEffect, useRef, useState } from 'react';

interface Props {
  name: string;
  /** Saves the document; resolves true when it was written (false: cancelled or failed). */
  onSave(): Promise<boolean>;
  onDiscard(): void;
  onCancel(): void;
}

/** "Save, Discard, or Cancel?" before something would drop the open document's unsaved work. */
export function UnsavedChangesDialog({ name, onSave, onDiscard, onCancel }: Props) {
  const [saving, setSaving] = useState(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  useEffect(() => saveButton.current?.focus(), []);

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
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <section className="dialog unsaved" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-text">
        <h2 id="unsaved-title">Unsaved changes</h2>
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
      </section>
    </div>
  );
}
