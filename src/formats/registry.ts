import type { FormatAdapter } from './types';
import { markdownAdapter, plaintextAdapter } from './text';

const ADAPTERS: FormatAdapter[] = [plaintextAdapter, markdownAdapter];

export function adapterFor(fileName: string): FormatAdapter | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = fileName.slice(dot).toLowerCase();
  return ADAPTERS.find((a) => a.exts.includes(ext)) ?? null;
}
