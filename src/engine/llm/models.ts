/** A model the app recognises by its file's SHA-256 (Settings › Modules › AI rewrites). */
export interface ModelInfo {
  id: string;
  label: string;
  /** The file name it is published under, to help the user find it. */
  fileName: string;
  sha256: string;
  sizeBytes: number;
  /** SPDX identifier. */
  licence: string;
}

/**
 * Qwen3.5-4B, IQ4_NL quantisation (unsloth/Qwen3.5-4B-GGUF), measured in Task 12 on the trust reference
 * documents. Pinned in deps/assets.json ("local-llm"). The app never downloads it: the user picks the file.
 */
export const DEFAULT_MODEL: ModelInfo = {
  id: 'qwen3.5-4b-iq4_nl',
  label: 'Qwen3.5-4B (IQ4_NL)',
  fileName: 'Qwen3.5-4B-IQ4_NL.gguf',
  sha256: 'ff5c3e9740a5aa53f04fdf3b0b8cc75da556bf8948cdb19d61c512d3a43465d9',
  sizeBytes: 2_579_944_608,
  licence: 'Apache-2.0',
};

export const MODELS: readonly ModelInfo[] = [DEFAULT_MODEL];

/** The known model with this file hash, or null for any other file ("Unknown model; use at your own risk"). */
export function knownModel(sha256: string): ModelInfo | null {
  const hash = sha256.toLowerCase();
  return MODELS.find((m) => m.sha256 === hash) ?? null;
}
