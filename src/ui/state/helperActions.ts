import { timeOneSentence } from '@/engine/llm/benchmark';
import type { Rewriter } from '@/engine/llm/suggest';
import type { ModuleSwitches } from '@/engine/modules';
import { msg } from '../i18n/message';
import { explain } from './errors';
import type { OptionalModules } from './optionalModules';
import { isLocalPath, modulesFor, type Settings } from './settings';
import type { ControllerState, ModelFiles } from './sessionController';

/** What the writing helper and model actions need from the controller. */
export interface HelperHost {
  state(): ControllerState;
  set(patch: Partial<ControllerState>): void;
  optional: OptionalModules;
  /** The model file dialog and hash; absent where no model can be chosen. */
  models: ModelFiles | undefined;
  /** Shows the new settings and saves them. */
  updateSettings(patch: Partial<Settings>): void;
}

/** The local writing helper, started on first use; null while AI rewrites are off or no model is chosen. */
export function helper(host: HelperHost): Promise<Rewriter> | null {
  const { settings } = host.state();
  const started = host.optional.helper(modulesFor(settings), settings.modelPath);
  return (
    started?.then((h) => {
      if (host.state().helperBackend !== h.backend) host.set({ helperBackend: h.backend });
      return h.rewriter;
    }) ?? null
  );
}

/**
 * The warm-up benchmark: seconds for one sample sentence on the started helper (starting it if needed), and
 * whether that is too slow to be useful. Null while AI rewrites are off.
 */
export async function benchmarkHelper(host: HelperHost, signal: AbortSignal): Promise<{ seconds: number; slow: boolean } | null> {
  const rewriter = helper(host);
  // The user's fallback English: no document is needed for the first-run benchmark.
  return rewriter && timeOneSentence(await rewriter, host.state().settings.fallbackVariant, signal);
}

/**
 * Settings › Modules › "Choose model file…": hashes the picked file (to name a known model) and stores its
 * path. A helper running the previous model is stopped; the next use starts the new one.
 */
export async function chooseModel(host: HelperHost): Promise<void> {
  const models = host.models;
  if (!models) return;
  let path: string | null;
  let sha256: string;
  try {
    path = await models.choose();
    if (path === null) return;
    // Reading a file on a network share would contact that host (llm.rs refuses such paths too).
    if (!isLocalPath(path)) throw new Error('The model file is on a network share. Copy it to this computer first.');
    host.set({ checkingModel: true });
    sha256 = await models.hash(path);
  } catch (e) {
    host.set({ checkingModel: false, error: explain(msg('error.model'), e, msg('error.modelNext')) });
    return;
  }
  releaseModules(host, { ...modulesFor(host.state().settings), aiRewrites: false });
  host.set({ checkingModel: false });
  host.updateSettings({ modelPath: path, modelSha256: sha256 });
}

/** Drops what switched-off modules hold: the dictionary, and the helper's process. A failed stop is shown. */
export function releaseModules(host: HelperHost, modules: ModuleSwitches): void {
  if (!modules.aiRewrites && host.state().helperBackend !== null) host.set({ helperBackend: null });
  host.optional.release(modules).catch((e) => host.set({ error: explain(msg('error.helperStop'), e, msg('error.helperStopNext')) }));
}
