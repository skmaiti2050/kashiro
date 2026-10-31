/**
 * A new version of the web app is ready (src/ui/web/useServiceWorker.ts). It stays until the user clicks Reload:
 * the page never reloads by itself, so a review in progress is never lost (spec "Offline / PWA").
 */
export function UpdateToast({ message, reloadLabel, onReload }: { message: string; reloadLabel: string; onReload(): void }) {
  return (
    <div className="undo-toast" role="status">
      <span>{message}</span>
      <button className="undo-toast-undo" onClick={onReload}>
        {reloadLabel}
      </button>
    </div>
  );
}
