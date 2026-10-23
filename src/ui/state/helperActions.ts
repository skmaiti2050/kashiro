import { timeOneSentence } from '@/engine/llm/benchmark';
import type { Rewriter } from '@/engine/llm/suggest';
import type { ModuleSwitches } from '@/engine/modules';
import { msg } from '../i18n/message';
import { explain } from './errors';
import { speedOfChosenModel } from './helperSpeed';
import type { OptionalModules, WritingHelper } from './optionalModules';
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
  /** Milliseconds, for timing the helper (default: performance.now). */
  clock?: () => number;
}

/** The started writing helper (starting it on first use, and showing its build); null while AI rewrites are off or no model is chosen. */
function startedHelper(host: HelperHost): Promise<WritingHelper> | null {
  const { settings } = host.state();
  const started = host.optional.helper(modulesFor(settings), settings.modelPath);
  return (
    started?.then((h) => {
      if (host.state().helperBackend !== h.backend) host.set({ helperBackend: h.backend });
      return h;
    }) ?? null
  );
}

/** The local writing helper, started on first use; null while AI rewrites are off or no model is chosen. */
export function helper(host: HelperHost): Promise<Rewriter> | null {
  return startedHelper(host)?.then((h) => h.rewriter) ?? null;
}

/**
 * The warm-up benchmark: seconds for one sample sentence on the started helper (starting it if needed), and
 * whether that is too slow to be useful. Null while AI rewrites are off.
 */
export async function benchmarkHelper(host: HelperHost, signal: AbortSignal): Promise<{ seconds: number; slow: boolean } | null> {
  const rewriter = helper(host);
  // The user's fallback English: no document is needed for the first-run benchmark.
  return rewriter && timeOneSentence(await rewriter, host.state().settings.fallbackVariant, signal, host.clock);
}

/**
 * The first-use speed check: when AI rewrites are on and the chosen model has not been timed yet, times one
 * sample sentence (starting the helper) and keeps the result in the settings, for the speed advice. Once per
 * model file. Rejects when the helper fails to start or answer.
 */
export async function measureSpeed(host: HelperHost, signal: AbortSignal): Promise<void> {
  const { settings } = host.state();
  const started = speedOfChosenModel(settings) ? null : startedHelper(host);
  if (!started || settings.modelPath === null) return;
  const h = await started;
  const { seconds } = await timeOneSentence(h.rewriter, settings.fallbackVariant, signal, host.clock);
  host.updateSettings({ helperSpeed: { modelPath: settings.modelPath, seconds, backend: h.backend, gpuFallback: h.gpuFallback ?? false } });
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
  // The new file is timed again the next time AI rewrites are used.
  host.updateSettings({ modelPath: path, modelSha256: sha256, helperSpeed: null });
}

/** Drops what switched-off modules hold: the dictionary, and the helper's process. A failed stop is shown. */
export function releaseModules(host: HelperHost, modules: ModuleSwitches): void {
  if (!modules.aiRewrites && host.state().helperBackend !== null) host.set({ helperBackend: null });
  host.optional.release(modules).catch((e) => host.set({ error: explain(msg('error.helperStop'), e, msg('error.helperStopNext')) }));
}
