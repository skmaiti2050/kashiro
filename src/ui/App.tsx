import { useEffect, useRef, useState } from 'react';
import { ChangeLog } from './ChangeLog';
import { DocumentView } from './DocumentView';
import { GoogleDocsHelp } from './GoogleDocsHelp';
import { ReviewPanel } from './ReviewPanel';
import { SettingsPanel } from './SettingsPanel';
import { Toolbar } from './Toolbar';
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

  useEffect(() => {
    let stop: (() => void) | null = null;
    let active = true;
    onFileDrop(
      (file) => {
        setPanel('none');
        void controller.openFile(file);
      },
      (e) => controller.showError(`Couldn't open the dropped file: ${message(e)}`),
    ).then((unlisten) => (active ? (stop = unlisten) : unlisten()));
    return () => {
      active = false;
      stop?.();
    };
  }, [controller]);

  const paste = async () => {
    // Reading the clipboard can be refused; an empty document to paste into works either way.
    const text = await navigator.clipboard.readText().catch(() => '');
    await controller.openText(text);
  };
  const openFromHelp = () => {
    setPanel('none');
    void controller.open();
  };

  return (
    <div className="app">
      <Toolbar controller={controller} state={state} onPaste={() => void paste()} onSettings={() => setPanel('settings')} onHelp={() => setPanel('help')} />
      {(state.error || state.notice) && (
        <p className={state.error ? 'banner error' : 'banner'} role="status">
          {state.error ?? state.notice}
        </p>
      )}
      <main className="workspace">
        <DocumentView controller={controller} state={state} />
        <ReviewPanel key={state.document?.id ?? 0} controller={controller} state={state} />
      </main>
      <ChangeLog controller={controller} state={state} open={logOpen} onToggle={() => setLogOpen((v) => !v)} />
      {panel === 'settings' && <SettingsPanel controller={controller} state={state} onClose={() => setPanel('none')} />}
      {panel === 'help' && <GoogleDocsHelp onOpen={openFromHelp} onClose={() => setPanel('none')} />}
    </div>
  );
}
