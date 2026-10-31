import type { Files, OpenedFile } from '../state/sessionController';

// A stub until the web adapters land (web plan, Task 2+): same exports as src/ui/platform/files.ts.
const notYet = (): never => {
  throw new Error('not available on the web yet');
};

export function setDialogLabels(_labels: { documents: string }): void {
  notYet();
}

export const files: Files = {
  open: async () => notYet(),
  save: async () => notYet(),
};

/** A file dropped on the page: its name now, its bytes only when the app decides to open it. */
export interface DroppedFile {
  name: string;
  read(): Promise<OpenedFile>;
}

export async function onFileDrop(_onDrop: (files: DroppedFile[]) => void): Promise<() => void> {
  return notYet();
}
