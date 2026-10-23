import { SLOW_SECONDS } from '@/engine/llm/benchmark';
import { msg, type Message } from '../i18n/message';
import type { HelperBackend } from './optionalModules';
import type { Settings } from './settings';

/** The warm-up benchmark's result, kept in the settings so it runs once per model file. */
export interface HelperSpeed {
  /** The model file it was measured with: another file is measured again. */
  modelPath: string;
  /** Seconds for one sample sentence. */
  seconds: number;
  backend: HelperBackend;
  /** The CPU build ran because the GPU build did not start. */
  gpuFallback: boolean;
}

/** The kept speed when it was measured for the model file now chosen, else null. */
export function speedOfChosenModel(settings: Pick<Settings, 'modelPath' | 'helperSpeed'>): HelperSpeed | null {
  const speed = settings.helperSpeed;
  return speed && speed.modelPath === settings.modelPath ? speed : null;
}

/**
 * The chosen model should be timed: never timed, or the helper now runs on another build than it was timed on
 * (`running`: the build running now, null while none runs).
 */
export function needsSpeedCheck(settings: Pick<Settings, 'modelPath' | 'helperSpeed'>, running: HelperBackend | null): boolean {
  const speed = speedOfChosenModel(settings);
  return !speed || (running !== null && running !== speed.backend);
}

/** Seconds as the advice shows them: one decimal at most ("about 6.6 s"). */
const shownSeconds = (seconds: number) => Math.round(seconds * 10) / 10;

/**
 * The first-use advice when the helper is slow on this PC (over SLOW_SECONDS per sentence), in plain words, with
 * a note when the GPU build failed and the CPU build stood in. Null when it is fast enough or not measured yet.
 */
export function speedAdvice(settings: Pick<Settings, 'modelPath' | 'helperSpeed'>): Message | null {
  const speed = speedOfChosenModel(settings);
  if (!speed || speed.seconds <= SLOW_SECONDS) return null;
  const slow = msg('ai.speedSlow', { seconds: shownSeconds(speed.seconds) });
  return speed.gpuFallback ? msg('ai.speedSlowGpuFailed', { slow, gpu: msg('ai.speedGpuFailed') }) : slow;
}

/** "About 2.9 s per sentence on this PC." for Settings, or null before it was measured. */
export function speedLine(settings: Pick<Settings, 'modelPath' | 'helperSpeed'>): Message | null {
  const speed = speedOfChosenModel(settings);
  return speed && msg('ai.speed', { seconds: shownSeconds(speed.seconds) });
}

const BACKENDS: readonly unknown[] = ['vulkan', 'cpu'];

/** A saved speed, or null when a hand-edited or damaged settings file holds something else. */
export function resolveHelperSpeed(value: unknown): HelperSpeed | null {
  if (typeof value !== 'object' || value === null) return null;
  const { modelPath, seconds, backend, gpuFallback } = value as Record<string, unknown>;
  if (typeof modelPath !== 'string' || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  if (!BACKENDS.includes(backend) || typeof gpuFallback !== 'boolean') return null;
  return { modelPath, seconds, backend: backend as HelperBackend, gpuFallback };
}
