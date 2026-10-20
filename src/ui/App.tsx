import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ChangeLog } from './ChangeLog';
import { DocumentView, type DocumentFocus } from './DocumentView';
import { GoogleDocsHelp } from './GoogleDocsHelp';
import { ReviewPanel } from './ReviewPanel';
import { SettingsPanel } from './SettingsPanel';
import { Toolbar } from './Toolbar';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { files, onFileDrop } from './platform/files';
import { createAppLinter } from './platform/linter';
import { loadSettings, saveSettings } from './platform/settings';
import { SessionController } from './state/sessionController';
import { useSession } from './state/useSession';
import './app.css';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [controller, setController] = useState<SessionController | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in development; one controller (and one linter) is enough.
    if (started.current) return;
    started.current = true;
    loadSettings().then(
      (settings) => {
        const c = new SessionController({ files, settings, saveSettings, createLinter: createAppLinter });
        setController(c);
        // Pre-warm Harper so the first check is quick (its first start takes ~650 ms).
        c.warmUp().catch((e) => c.showError(`The checker could not start: ${message(e)}`));
      },
      (e) => setStartError(`Settings could not be loaded: ${message(e)}`),
    );
  }, []);

  if (!controller) return <main className="starting">{startError ?? 'Starting…'}</main>;
  return <Shell controller={controller} />;
}

function Shell({ controller }: { controller: SessionController }) {
  const state = useSession(controller);
  const [panel, setPanel] = useState<'none' | 'settings' | 'help'>('none');
  const [logOpen, setLogOpen] = useState(false);
  const [focus, setFocus] = useState<DocumentFocus | null>(null);
  /** What to do once the user has answered "Save, Discard, or Cancel?". */
  const [afterUnsaved, setAfterUnsaved] = useState<(() => void) | null>(null);

  /** Runs `action` now, or after the unsaved-changes dialog when it would drop unsaved work. */
  const unlessUnsaved = useCallback(
    (action: () => void) => {
      if (controller.hasUnsavedWork()) setAfterUnsaved(() => action);
      else action();
    },
    [controller],
  );

  useEffect(() => {
    return listenWhileMounted(
      onFileDrop(
        (file) => {
          setPanel('none');
          unlessUnsaved(() => void controller.openFile(file));
        },
        (e) => controller.showError(`Couldn't open the dropped file: ${message(e)}`),
      ),
    );
  }, [controller, unlessUnsaved]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    return listenWhileMounted(
      appWindow.onCloseRequested((event) => {
        if (!controller.hasUnsavedWork()) return;
        event.preventDefault();
        setAfterUnsaved(() => () => void appWindow.destroy());
      }),
    );
  }, [controller]);

  const paste = async () => {
    // Reading the clipboard can be refused; an empty document to paste into works either way.
    const text = await navigator.clipboard.readText().catch(() => '');
    await controller.openText(text);
  };
  const openFromHelp = () => {
    setPanel('none');
    unlessUnsaved(() => void controller.open());
  };

  return (
    <div className="app">
      <Toolbar
        controller={controller}
        state={state}
        onOpen={() => unlessUnsaved(() => void controller.open())}
        onPaste={() => unlessUnsaved(() => void paste())}
        onSettings={() => setPanel('settings')}
        onHelp={() => setPanel('help')}
      />
      {(state.error || state.notice) && (
        <p className={state.error ? 'banner error' : 'banner'} role="status">
          {state.error ?? state.notice}
        </p>
      )}
      <main className="workspace">
        <DocumentView controller={controller} state={state} focus={focus} />
        <ReviewPanel
          key={state.document?.id ?? 0}
          controller={controller}
          state={state}
          onLocate={(candidate) => setFocus((f) => ({ candidate, seq: (f?.seq ?? 0) + 1 }))}
        />
      </main>
      <ChangeLog controller={controller} state={state} open={logOpen} onToggle={() => setLogOpen((v) => !v)} />
      {panel === 'settings' && <SettingsPanel controller={controller} state={state} onClose={() => setPanel('none')} />}
      {panel === 'help' && <GoogleDocsHelp onOpen={openFromHelp} onClose={() => setPanel('none')} />}
      {afterUnsaved && (
        <UnsavedChangesDialog
          name={state.document?.name ?? 'this document'}
          onSave={() => controller.save()}
          onDiscard={() => {
            setAfterUnsaved(null);
            afterUnsaved();
          }}
          onCancel={() => setAfterUnsaved(null)}
        />
      )}
    </div>
  );
}

/** Subscribes for as long as the component is mounted, even if it unmounts before the listener is ready. */
function listenWhileMounted(subscribing: Promise<() => void>): () => void {
  let unlisten: (() => void) | null = null;
  let mounted = true;
  subscribing.then((stop) => (mounted ? (unlisten = stop) : stop()));
  return () => {
    mounted = false;
    unlisten?.();
  };
}
