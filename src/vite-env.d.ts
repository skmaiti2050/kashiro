/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The web build's date (YYYY-MM-DD), set by scripts/build-web.ts; unset on the desktop. */
  readonly VITE_BUILD_DATE?: string;
  /** The web build's id, a hash of its files: names the service worker's cache (set by scripts/build-web.ts). */
  readonly VITE_KASHIRO_BUILD_ID?: string;
}
