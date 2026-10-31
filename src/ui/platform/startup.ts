import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';

/** Shows the app. Harper's wasm is a file inside the installed app, so there is nothing to wait for first. */
export function startApp(root: Root, app: ReactNode): void {
  root.render(app);
}
