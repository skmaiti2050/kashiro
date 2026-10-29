import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Banners } from './Banners';
import { BugReportDialog } from './BugReportDialog';
import { ChangeLog } from './ChangeLog';
import { CommandPalette } from './CommandPalette';
import { paletteCommands } from './paletteCommands';
import { DictionaryPanel } from './DictionaryPanel';
import { DocumentView, type DocumentFocus } from './DocumentView';
import { GoogleDocsHelp } from './GoogleDocsHelp';
import { LookupPanel } from './LookupPanel';
import { ResumeDialog } from './ResumeDialog';
import { ReviewPanel, type CardRequest, type CaretText, type PanelCommands } from './ReviewPanel';
import { SettingsPanel, type SettingsTab } from './SettingsPanel';
import { ShortcutsSheet } from './ShortcutsSheet';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { UndoToast } from './UndoToast';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { rememberTourSeen, tourSeen, WelcomeTour } from './WelcomeTour';
import { PanelDivider } from './PanelDivider';
import { useAppShortcuts } from './useKeys';
import { usePanelSplit } from './usePanelSplit';
import { useReadAloud } from './useReadAloud';
import { useWordLookup } from './useWordLookup';
import { useShowWindowWhenDrawn } from './useShowWindowWhenDrawn';
import { msg, type Message } from './i18n/message';
import { translatorFor } from './i18n/translatorFor';
import { TranslatorProvider, useT } from './i18n/useT';
import { loadAppDictionary } from './platform/dictionary';
import { files, onFileDrop, setDialogLabels } from './platform/files';
import { helperInstalled, modelFiles, startAppHelper, stopAppHelper } from './platform/helper';
import { createAppLinter } from './platform/linter';
import { openProjectPage } from './platform/links';
import { sessionFiles } from './platform/sessions';
import { rememberWindowPlacement } from './platform/windowPlacement';
import { changeLogWasOpen, rememberChangeLogOpen } from './changeLogMemory';
import { loadSettings, saveSettings } from './platform/settings';
import { explain } from './state/errors';
import { readingStyle } from './state/readingSettings';
import { SessionController, type ControllerState } from './state/sessionController';
import { modulesFor } from './state/settings';
import { useSession } from './state/useSession';
import { windowTitle } from './state/windowTitle';
import { useTheme } from './theme';
import './fonts';
import './app.css';
import './a11y.css';

// Loaded when first opened: the notice texts stay out of the main bundle.
const AboutDialog = lazy(() => import('./AboutDialog').then((module) => ({ default: module.AboutDialog })));

/** Loading shorter than this shows no "Starting…", so a quick start doesn't flash it. */
const SLOW_START_MS = 300;

export default function App() {
  const [controller, setController] = useState<SessionController | null>(null);
  const [startError, setStartError] = useState<Message | null>(null);
  const [slowStart, setSlowStart] = useState(false);
  const started = useRef(false);

  useShowWindowWhenDrawn();
  // Started at once: the window is still hidden, so it appears where it was last time (F22 item 5).
  useEffect(() => rememberWindowPlacement(), []);
  useEffect(() => {
    const slow = setTimeout(() => setSlowStart(true), SLOW_START_MS);
    return () => clearTimeout(slow);
  }, []);

  useEffect(() => {
    // StrictMode runs effects twice in development; one controller (and one linter) is enough.
    if (started.current) return;
    started.current = true;
    Promise.all([loadSettings(), helperInstalled()]).then(
      ([settings, installed]) => {
        const c = new SessionController({
          files,
          settings,
          saveSettings,
          createLinter: createAppLinter,
          sessions: sessionFiles,
          loadDictionary: loadAppDictionary,
          // Without the helper's files (the version without AI) nothing can start it.
          ...(installed && { startHelper: startAppHelper, stopHelper: stopAppHelper, models: modelFiles }),
          helperInstalled: installed,
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
        {startError ? t.format(startError) : slowStart && t.t('app.starting')}
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
  const [panel, setPanel] = useState<'none' | 'settings' | 'dictionary' | 'bug' | 'help' | 'shortcuts' | 'about' | 'palette' | 'tour'>('none');
  /** The tab Settings opens on when the command palette names one; else Settings' own remembered tab. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  /** The review panel's actions for the command palette (null while the panel is folded). */
  const panelCommands = useRef<PanelCommands | null>(null);
  const { lookup, state: lookupState } = useWordLookup(controller);
  const readAloud = useReadAloud(state.settings.reading, state.document?.id ?? null);
  const caretReader = useRef<() => CaretText | null>(() => null);
  const improveAtCaret = useRef<() => void>(() => {});
  const lookUpAtCaret = useRef<() => boolean>(() => false);
  /** Bumped by Ctrl+F outside the text and by the command palette: DocumentView opens Find (F23b). */
  const [findRequest, setFindRequest] = useState(0);
  const [logOpen, setLogOpen] = useState(changeLogWasOpen);
  useEffect(() => rememberChangeLogOpen(logOpen), [logOpen]);
  /** Bumped by "See the change log": the log then takes focus and is shown, even when already open (F20 item 8). */
  const [logReveals, setLogReveals] = useState(0);
  const [focus, setFocus] = useState<DocumentFocus | null>(null);
  const [cardRequest, setCardRequest] = useState<CardRequest | null>(null);
  /** What to do once the user has answered "Save, Discard, or Cancel?". */
  const [afterUnsaved, setAfterUnsaved] = useState<(() => void) | null>(null);
  const split = usePanelSplit();

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
      onFileDrop((dropped) => {
        // The first file Kashiro can open; one it can't is refused before the unsaved-work prompt (F21b item 9).
        const file = dropped.find((f) => controller.canOpen(f.name));
        if (!file) return controller.showError(msg('error.unsupported', { name: dropped[0].name }));
        setPanel('none');
        unlessUnsaved(() =>
          file.read().then(
            (opened) => controller.openFile(opened),
            (e) => controller.showError(explain(msg('error.drop'), e, msg('error.dropNext'))),
          ),
        );
      }),
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

  // An opened file names the window; a paste or the sample keeps the app's name (F20 item 11). "● " marks work
  // the unsaved-changes prompt would ask about (F21b item 7); the controller's state changes with every such change.
  const title = windowTitle(state.document, state.document !== null && controller.hasUnsavedWork());
  useEffect(() => {
    void getCurrentWindow().setTitle(title);
  }, [title]);

  const paste = async () => {
    const text = await readClipboardText();
    // Refused: an empty document to paste into with Ctrl+V works anyway.
    if (text === null) return controller.openText('');
    // An image or a file copied in Explorer reads as '': say so, and keep the open document as it is.
    if (text.trim() === '') return controller.showNotice(msg('notice.clipboardNoText'));
    await controller.openText(text);
  };
  const onOpen = () => unlessUnsaved(() => void controller.open());
  const onPaste = () => unlessUnsaved(() => void paste());
  const onClose = () => unlessUnsaved(() => void controller.close());
  // Only on the user's click: nothing checks for updates on its own (F23 item 4).
  const checkForUpdates = () => void openProjectPage('releases').catch(() => controller.showError(msg('updates.openFailed')));
  const openFromHelp = () => {
    setPanel('none');
    onOpen();
  };
  const openSettings = (tab?: SettingsTab) => {
    setSettingsTab(tab);
    setPanel('settings');
  };
  const dialogOpen = panel !== 'none' || afterUnsaved !== null || state.resumeOffer !== null || lookupState !== null;
  // The welcome tour, once, when the first document's check is done and nothing else is open (F23 item 7).
  useEffect(() => {
    if (!state.session || dialogOpen || tourSeen()) return;
    rememberTourSeen();
    setPanel('tour');
  }, [state.session, dialogOpen]);
  const lookUpOn = modulesFor(state.settings).wordLookup;
  const aiOn = controller.ai.available();
  const lookUpFromMenu = lookUpOn ? () => lookUpAtCaret.current() || controller.showNotice(msg('lookup.noWord')) : null;
  const improveFromToolbar = aiOn && state.session ? () => improveAtCaret.current() : null;
  const find = () => setFindRequest((n) => n + 1);
  useAppShortcuts(state.document !== null, (shortcut) => {
    if (dialogOpen) return;
    if (shortcut === 'find') find();
    else if (shortcut === 'open') onOpen();
    else if (shortcut === 'paste') onPaste();
    else if (shortcut === 'close') onClose();
    else if (shortcut === 'settings') openSettings();
    else setPanel(shortcut);
  });

  const { reading } = state.settings;
  /** Built when the palette opens: each entry calls the same function as its button or menu item (F23 item 6). */
  const commands = () =>
    paletteCommands(t, {
      hasDocument: state.document !== null,
      hasSession: state.session !== null,
      onOpen,
      onPaste,
      onSave: () => void controller.save(),
      onClose,
      onSettings: openSettings,
      onDictionary: () => setPanel('dictionary'),
      onTheme: (theme) => controller.changeSettings({ reading: { ...reading, theme } }),
      onToggleLog: () => setLogOpen((v) => !v),
      onExportReport: () => void controller.exportReport(),
      panelCollapsed: split.collapsed,
      onTogglePanel: () => split.setCollapsed(!split.collapsed),
      onShortcuts: () => setPanel('shortcuts'),
      onHelp: () => setPanel('help'),
      onReportBug: () => setPanel('bug'),
      onCheckUpdates: checkForUpdates,
      onAbout: () => setPanel('about'),
      onTour: () => setPanel('tour'),
      onFind: find,
      onLookUp: lookUpFromMenu,
      onImprove: improveFromToolbar,
      panel: split.collapsed ? null : panelCommands.current,
    });
  useTheme(reading.theme);
  // Stable, so a re-render doesn't restart the toast's timer.
  const dismissUndoOffer = useCallback(() => controller.dismissUndoOffer(), [controller]);
  useEffect(() => {
    // The whole page, so text outside .app (none yet) and the native spell-check language follow too.
    document.documentElement.lang = t.language;
    document.documentElement.dir = t.dir;
    setDialogLabels({ documents: t.t('files.documents') });
  }, [t]);

  return (
    <div
      className="app"
      lang={t.language}
      dir={t.dir}
      style={readingStyle(reading) as CSSProperties}
      data-font={reading.font}
      data-key-hints={reading.keyHints ? 'on' : 'off'}
    >
      <header className="app-header">
        <Toolbar
          controller={controller}
          state={state}
          onOpen={onOpen}
          onPaste={onPaste}
          onSettings={() => openSettings()}
          onDictionary={() => setPanel('dictionary')}
          onReportBug={() => setPanel('bug')}
          onCheckUpdates={checkForUpdates}
          onHelp={() => setPanel('help')}
          onShortcuts={() => setPanel('shortcuts')}
          onAbout={() => setPanel('about')}
          onTour={() => setPanel('tour')}
          onClose={onClose}
          onLookUp={lookUpFromMenu}
          onImprove={improveFromToolbar}
        />
        <Banners controller={controller} state={state} />
        <p className="visually-hidden" role="status" aria-atomic="true" data-live-regions>
          {state.announcement && <span key={state.announcement.seq}>{t.format(state.announcement.message)}</span>}
        </p>
        <p className="visually-hidden" role="status" aria-atomic="true" data-live-regions>
          {lookupState?.announcement && <span key={lookupState.announcement.seq}>{t.format(lookupState.announcement.message)}</span>}
        </p>
      </header>
      <main className="workspace" data-panel={split.collapsed ? 'collapsed' : 'open'} style={split.style}>
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
          lookUpAtCaret={lookUpAtCaret}
          findRequest={findRequest}
        />
        {split.collapsed ? (
          <div className="review-strip">
            <button className="quiet" aria-label={t.t('split.show')} title={t.t('split.show')} onClick={() => split.setCollapsed(false)}>
              <span aria-hidden="true">‹</span>
            </button>
          </div>
        ) : (
          <>
            <PanelDivider width={split.width} onResize={split.resize} />
            <ReviewPanel
              key={state.document?.id ?? 0}
              controller={controller}
              state={state}
              onLocate={(candidate) => setFocus((f) => ({ candidate, seq: (f?.seq ?? 0) + 1 }))}
              request={cardRequest}
              keysEnabled={!dialogOpen}
              onShowLog={() => {
                setLogOpen(true);
                setLogReveals((n) => n + 1);
              }}
              onSave={() => void controller.save()}
              readAloud={readAloud}
              readCaret={() => caretReader.current()}
              onLookUp={lookUpOn ? (words) => void lookup.open(words) : undefined}
              onCollapse={() => split.setCollapsed(true)}
              commands={panelCommands}
            />
          </>
        )}
      </main>
      <StatusBar state={state} />
      <ChangeLog controller={controller} state={state} open={logOpen} onToggle={() => setLogOpen((v) => !v)} reveals={logReveals} />
      {/* Not behind a dialog: it would be inert there, a status no one hears and an Undo no one can reach. */}
      {state.undoOffer && !dialogOpen && (
        <UndoToast
          key={state.undoOffer.seq}
          message={t.format(state.undoOffer.message)}
          undoLabel={t.t('toast.undo')}
          onUndo={() => {
            const back = controller.undoBigAction();
            // The places are back in review: show their card, with focus, so focus doesn't fall to the page.
            if (back) setCardRequest((r) => ({ candidateId: back, seq: (r?.seq ?? 0) + 1, focus: true }));
          }}
          onDismiss={dismissUndoOffer}
        />
      )}
      {panel === 'settings' && (
        <SettingsPanel
          controller={controller}
          state={state}
          readAloud={readAloud}
          initialTab={settingsTab}
          onOpenDictionary={() => setPanel('dictionary')}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'tour' && <WelcomeTour onClose={() => setPanel('none')} />}
      {panel === 'palette' && (
        <CommandPalette
          commands={commands()}
          onRun={(command) => {
            setPanel('none');
            command.run();
          }}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'dictionary' && <DictionaryPanel controller={controller} dictionary={state.settings.dictionary} onClose={() => setPanel('none')} />}
      {panel === 'bug' && <BugReportDialog controller={controller} onClose={() => setPanel('none')} />}
      {panel === 'help' && <GoogleDocsHelp onOpen={openFromHelp} onClose={() => setPanel('none')} />}
      {panel === 'shortcuts' && <ShortcutsSheet readAloud={readAloud !== null} lookUp={lookUpOn} improve={aiOn} onClose={() => setPanel('none')} />}
      {panel === 'about' && (
        <Suspense fallback={null}>
          <AboutDialog onCheckUpdates={checkForUpdates} onClose={() => setPanel('none')} />
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

/** The clipboard's text ('' when it holds none), or null when reading it was refused. */
async function readClipboardText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
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
