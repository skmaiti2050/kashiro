import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { LlmClient } from '@/engine/llm/client';
import type { ModelFiles } from '../state/sessionController';
import type { HelperBackend, WritingHelper } from '../state/optionalModules';

/** What llm_start returns (src-tauri/src/llm.rs): the server's port, this launch's key, and the build that runs. */
interface HelperInfo {
  port: number;
  apiKey: string;
  backend: HelperBackend;
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
  const { port, apiKey, backend } = await invoke<HelperInfo>('llm_start', { modelPath });
  return {
    rewriter: new LlmClient({ port, apiKey }),
    backend,
    stop: () => invoke<void>('llm_stop'),
  };
}
