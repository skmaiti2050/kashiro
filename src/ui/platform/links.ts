import { invoke } from '@tauri-apps/api/core';

/**
 * Opens one of the project's GitHub pages in the default browser (F22 item 4), only when the user clicks. The app
 * passes a page name, never a URL: Rust builds it from PROJECT_URL (src/ui/projectLinks.ts) and opens nothing else.
 */
export function openProjectPage(page: 'issues'): Promise<void> {
  return invoke<void>('open_project_page', { page });
}
