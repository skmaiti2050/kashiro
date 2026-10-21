import { createLinter } from '@/engine/linter';
import { ReviewPanel, type CardRequest } from '@/ui/ReviewPanel';
import { SessionController, type Files } from '@/ui/state/sessionController';
import { defaultSettings, type Settings } from '@/ui/state/settings';
import { useSession } from '@/ui/state/useSession';

/** Files that open nothing and "save" beside the suggested path. */
export const noFiles: Files = {
  open: async () => null,
  save: async (path, _bytes, { overwrite }) => ({ path, backup: overwrite ? path.replace(/(\.\w+)$/, '.bak$1') : null }),
};

/** Compiles Harper's WASM once per file (the first build is slow), so tests stay within their timeout. */
export async function warmLinter(): Promise<void> {
  await createLinter('American');
}

/** A controller over the real linter (built per check, so added words are known), recording saved settings. */
export function makeController(settings: Partial<Settings> = {}, files: Files = noFiles) {
  const saved: Settings[] = [];
  const controller = new SessionController({
    files,
    createLinter: (variant, words) => createLinter(variant, words),
    saveSettings: async (s) => {
      saved.push(s);
    },
    settings: { ...defaultSettings('en-US'), preset: 'academic', ...settings },
  });
  return { controller, saved };
}

interface PanelProps {
  controller: SessionController;
  request?: CardRequest | null;
  onLocate?: Parameters<typeof ReviewPanel>[0]['onLocate'];
}

/** The review panel as the app mounts it, re-rendering with the controller. */
export function Panel({ controller, request = null, onLocate = () => {} }: PanelProps) {
  const state = useSession(controller);
  return (
    <ReviewPanel
      key={state.document?.id ?? 0}
      controller={controller}
      state={state}
      onLocate={onLocate}
      request={request}
      keysEnabled
      onShowLog={() => {}}
      onSave={() => {}}
      readAloud={null}
      readCaret={() => null}
    />
  );
}
