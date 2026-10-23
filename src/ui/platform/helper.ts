import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { LlmClient } from '@/engine/llm/client';
import type { ModelFiles } from '../state/sessionController';
import type { HelperBackend, WritingHelper } from '../state/optionalModules';

/** What llm_start returns (src-tauri/src/llm.rs): the server's port, this launch's key, the build that runs, and whether the GPU build failed first. */
interface HelperInfo {
  port: number;
  apiKey: string;
  backend: HelperBackend;
  gpuFallback: boolean;
}

/**
 * The writing helper's model file. The dialog puts the picked file in the fs scope (for this session only),
 * which sha256_file checks; the app never reads, copies or downloads the model itself.
 */
export const modelFiles: ModelFiles = {
  async choose() {
    return open({ multiple: false, directory: false, filters: [{ name: 'GGUF', extensions: ['gguf'] }] });
  },
  hash: (path) => invoke<string>('sha256_file', { path }),
};

/**
 * Starts llama-server (Rust runs the bundled Vulkan build when a GPU is usable, else the CPU build, on 127.0.0.1
 * with a fresh key) and returns its client. Stopping ends the server process.
 */
export async function startAppHelper(modelPath: string): Promise<WritingHelper> {
  const { port, apiKey, backend, gpuFallback } = await invoke<HelperInfo>('llm_start', { modelPath });
  return {
    rewriter: new LlmClient({ port, apiKey }),
    backend,
    gpuFallback,
    stop: stopAppHelper,
  };
}

/** Whether the writing helper's files are installed (the version without AI leaves them out). */
export const helperInstalled = (): Promise<boolean> => invoke<boolean>('llm_installed');

/** Stops the server, also one still loading its model (llm.rs then cancels that start). */
export const stopAppHelper = (): Promise<void> => invoke<void>('llm_stop');
