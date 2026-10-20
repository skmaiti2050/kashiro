interface Props {
  onOpen(): void;
  onClose(): void;
}

/** How to check a Google Doc: download as .docx, fix here, upload back. Dropping a file anywhere opens it. */
export function GoogleDocsHelp({ onOpen, onClose }: Props) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section className="dialog" role="dialog" aria-label="Checking a Google Doc" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Checking a Google Doc</h2>
          <button className="quiet" onClick={onClose}>
            Close
          </button>
        </header>
        <ol className="steps">
          <li>
            In Google Docs: <b>File → Download → Microsoft Word (.docx)</b>.
          </li>
          <li>Drop the downloaded file here, or open it.</li>
          <li>Review the changes, then Save. Edits are saved as tracked changes.</li>
          <li>
            In Google Docs: <b>File → Open → Upload</b> and pick the saved file. The changes show as suggestions.
          </li>
        </ol>
        <div className="dropzone">
          <p>Drop the .docx here</p>
          <button onClick={onOpen}>Open a file…</button>
        </div>
      </section>
    </div>
  );
}
