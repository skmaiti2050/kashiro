import { Dialog } from './Dialog';

interface Props {
  onOpen(): void;
  onClose(): void;
}

/** How to check a Google Doc: download as .docx, fix here, upload back. Dropping a file anywhere opens it. */
export function GoogleDocsHelp({ onOpen, onClose }: Props) {
  return (
    <Dialog title="Checking a Google Doc" onClose={onClose}>
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
    </Dialog>
  );
}
