import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ChangeLog } from './ChangeLog';
import { DocumentView, type DocumentFocus } from './DocumentView';
import { GoogleDocsHelp } from './GoogleDocsHelp';
import { LookupPanel } from './LookupPanel';
import { ResumeDialog } from './ResumeDialog';
import { ReviewPanel, type CardRequest, type CaretText } from './ReviewPanel';
import { SettingsPanel } from './SettingsPanel';
import { ShortcutsSheet } from './ShortcutsSheet';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { useAppShortcuts } from './useKeys';
import { useReadAloud } from './useReadAloud';
import { useWordLookup } from './useWordLookup';
import { msg, type Message } from './i18n/message';
import { translatorFor } from './i18n/translatorFor';
import { TranslatorProvider, useT } from './i18n/useT';
import { loadAppDictionary } from './platform/dictionary';
import { files, onFileDrop, setDialogLabels } from './platform/files';
import { modelFiles, startAppHelper, stopAppHelper } from './platform/helper';
import { createAppLinter } from './platform/linter';
import { sessionFiles } from './platform/sessions';
import { loadSettings, saveSettings } from './platform/settings';
import { explain } from './state/errors';
import { readingStyle } from './state/readingSettings';
import { SessionController, type ControllerState } from './state/sessionController';
import { modulesFor } from './state/settings';
import { useSession } from './state/useSession';
import './fonts';
import './app.css';
import './a11y.css';

// Loaded when first opened: the notice texts stay out of the main bundle.
const AboutDialog = lazy(() => import('./AboutDialog').then((module) => ({ default: module.AboutDialog })));

export default function App() {
  const [controller, setController] = useState<SessionController | null>(null);
  const [startError, setStartError] = useState<Message | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in development; one controller (and one linter) is enough.
    if (started.current) return;
    started.current = true;
    loadSettings().then(
      (settings) => {
        const c = new SessionController({
          files,
          settings,
          saveSettings,
          createLinter: createAppLinter,
          sessions: sessionFiles,
          loadDictionary: loadAppDictionary,
          startHelper: startAppHelper,
          stopHelper: stopAppHelper,
          models: modelFiles,
        });
        setController(c);
        // Deletes saved reviews past their retention, then lists the rest (failures show as an error banner).
        void c.reviews.startUp();
        // Pre-warm Harper so the first check is quick (its first start takes ~650 ms).
        c.warmUp().catch((e) => c.showError(explain(msg('error.checkerStart'), e, msg('error.checkerStartNext'))));
      },
      (e) => setStartError(explain(msg('error.settingsLoad'), e, msg('error.settingsLoadNext'))),
    );
  }, []);

  if (!controller) {
    // Before settings load, the Windows language.
    const t = translatorFor('system');
    return (
      <main className="starting" lang={t.language} dir={t.dir}>
        {startError ? t.format(startError) : t.t('app.starting')}
      </main>
    );
  }
  return <Shell controller={controller} />;
}

/** The app once settings are loaded (exported for the DOM tests). */
export function Shell({ controller }: { controller: SessionController }) {
  const state = useSession(controller);
  const t = translatorFor(state.settings.uiLanguage);
  return (
    <TranslatorProvider translator={t}>
      <ShellView controller={controller} state={state} />
    </TranslatorProvider>
  );
}

function ShellView({ controller, state }: { controller: SessionController; state: ControllerState }) {
  const t = useT();
  const [panel, setPanel] = useState<'none' | 'settings' | 'help' | 'shortcuts' | 'about'>('none');
  const { lookup, state: lookupState } = useWordLookup(controller);
  const readAloud = useReadAloud(state.settings.reading);
  const caretReader = useRef<() => CaretText | null>(() => null);
  const improveAtCaret = useRef<() => void>(() => {});
  const [logOpen, setLogOpen] = useState(false);
  const [focus, setFocus] = useState<DocumentFocus | null>(null);
  const [cardRequest, setCardRequest] = useState<CardRequest | null>(null);
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
        (e) => controller.showError(explain(msg('error.drop'), e, msg('error.dropNext'))),
      ),
    );
  }, [controller, unlessUnsaved]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    return listenWhileMounted(
      appWindow.onCloseRequested(async (event) => {
        // The autosave waiting for its 1 s pause is written before the window goes (Tauri awaits this handler).
        // If that write fails, the window stays open with the error showing; closing again goes ahead.
        if (!(await controller.reviews.flush())) {
          event.preventDefault();
          return;
        }
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
  const onOpen = () => unlessUnsaved(() => void controller.open());
  const onPaste = () => unlessUnsaved(() => void paste());
  const openFromHelp = () => {
    setPanel('none');
    onOpen();
  };
  const dialogOpen = panel !== 'none' || afterUnsaved !== null || state.resumeOffer !== null || lookupState !== null;
  const lookUpOn = modulesFor(state.settings).wordLookup;
  const aiOn = controller.ai.available();
  useAppShortcuts(state.document !== null, (shortcut) => {
    if (dialogOpen) return;
    if (shortcut === 'open') onOpen();
    else if (shortcut === 'paste') onPaste();
    else setPanel(shortcut);
  });
  const { reading } = state.settings;
  useEffect(() => {
    // The whole page, so text outside .app (none yet) and the native spell-check language follow too.
    document.documentElement.lang = t.language;
    document.documentElement.dir = t.dir;
    setDialogLabels({ documents: t.t('files.documents') });
  }, [t]);

  return (
    <div className="app" lang={t.language} dir={t.dir} style={readingStyle(reading) as CSSProperties} data-font={reading.font}>
      <header className="app-header">
        <Toolbar
          controller={controller}
          state={state}
          onOpen={onOpen}
          onPaste={onPaste}
          onSettings={() => setPanel('settings')}
          onHelp={() => setPanel('help')}
          onShortcuts={() => setPanel('shortcuts')}
          onAbout={() => setPanel('about')}
          onImprove={aiOn && state.session ? () => improveAtCaret.current() : null}
        />
        {/*
          Live regions exist before their text arrives, so screen readers announce it. data-live-regions keeps
          them out of a dialog's inert page (Dialog.tsx), so an error raised behind a dialog is still heard.
        */}
        <div className="banners" data-live-regions>
          <div role="alert">{state.error && <p className="banner error">{t.format(state.error)}</p>}</div>
          <div role="status">{state.notice && !state.error && <p className="banner">{t.format(state.notice)}</p>}</div>
        </div>
        <p className="visually-hidden" role="status" aria-atomic="true" data-live-regions>
          {state.announcement && <span key={state.announcement.seq}>{t.format(state.announcement.message)}</span>}
        </p>
        <p className="visually-hidden" role="status" aria-atomic="true" data-live-regions>
          {lookupState?.announcement && <span key={lookupState.announcement.seq}>{t.format(lookupState.announcement.message)}</span>}
        </p>
      </header>
      <main className="workspace">
        <DocumentView
          controller={controller}
          state={state}
          focus={focus}
          onUnderlineClick={(candidateId, fromKeyboard) =>
            setCardRequest((r) => ({ candidateId, seq: (r?.seq ?? 0) + 1, focus: fromKeyboard || undefined }))
          }
          onOpen={onOpen}
          onPaste={onPaste}
          onSample={() => unlessUnsaved(() => void controller.openSample())}
          onOpenRecent={(review) => unlessUnsaved(() => void controller.reviews.openRecent(review))}
          caretReader={caretReader}
          onLookUp={lookUpOn && !dialogOpen ? (word) => void lookup.open([word]) : null}
          aiOn={aiOn && !dialogOpen}
          improveAtCaret={improveAtCaret}
        />
        <ReviewPanel
          key={state.document?.id ?? 0}
          controller={controller}
          state={state}
          onLocate={(candidate) => setFocus((f) => ({ candidate, seq: (f?.seq ?? 0) + 1 }))}
          request={cardRequest}
          keysEnabled={!dialogOpen}
          onShowLog={() => setLogOpen(true)}
          onSave={() => void controller.save()}
          readAloud={readAloud}
          readCaret={() => caretReader.current()}
          onLookUp={lookUpOn ? (words) => void lookup.open(words) : undefined}
        />
      </main>
      <StatusBar state={state} />
      <ChangeLog controller={controller} state={state} open={logOpen} onToggle={() => setLogOpen((v) => !v)} />
      {panel === 'settings' && <SettingsPanel controller={controller} state={state} readAloud={readAloud} onClose={() => setPanel('none')} />}
      {panel === 'help' && <GoogleDocsHelp onOpen={openFromHelp} onClose={() => setPanel('none')} />}
      {panel === 'shortcuts' && <ShortcutsSheet readAloud={readAloud !== null} lookUp={lookUpOn} improve={aiOn} onClose={() => setPanel('none')} />}
      {panel === 'about' && (
        <Suspense fallback={null}>
          <AboutDialog onClose={() => setPanel('none')} />
        </Suspense>
      )}
      {lookupState && <LookupPanel lookup={lookupState} onClose={() => lookup.close()} />}
      {state.resumeOffer && (
        <ResumeDialog
          offer={state.resumeOffer}
          onResume={() => void controller.reviews.resume()}
          onStartFresh={() => void controller.reviews.startFresh()}
          onDismiss={() => controller.reviews.dismiss()}
        />
      )}
      {afterUnsaved && (
        <UnsavedChangesDialog
          name={state.document?.name ?? t.t('unsaved.thisDocument')}
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
