import { defineConfig, normalizePath, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { webIcons, webPageHead } from "./scripts/webBuild.ts";

const host = process.env.TAURI_DEV_HOST;

/** KASHIRO_TARGET=web builds the web app (scripts/build-web.ts); anything else is the desktop app. */
const web = process.env.KASHIRO_TARGET === "web";

const DESKTOP_PLATFORM = normalizePath(fileURLToPath(new URL("./src/ui/platform/", import.meta.url)));
const WEB_PLATFORM = normalizePath(fileURLToPath(new URL("./src/ui/platform-web/", import.meta.url)));

/**
 * The web build's platform switch: every import that resolves into src/ui/platform/<x> loads
 * src/ui/platform-web/<x> instead, so the web bundle holds no Tauri code (and the desktop one no web code).
 */
function webPlatform(): Plugin {
  return {
    name: "kashiro-web-platform",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || !resolved.id.startsWith(DESKTOP_PLATFORM)) return resolved;
      return WEB_PLATFORM + resolved.id.slice(DESKTOP_PLATFORM.length);
    },
  };
}

const DICTIONARY = fileURLToPath(new URL("./resources/dictionary/oewn.json.gz", import.meta.url));

/**
 * Word lookup's dictionary in the web build, at <base>dictionary/oewn.json.gz: the site serves it itself, never a
 * CDN (src/ui/platform-web/dictionary.ts fetches it). The desktop app reads it as a Tauri resource instead.
 */
function webDictionary(): Plugin {
  return {
    name: "kashiro-web-dictionary",
    apply: "build",
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: "dictionary/oewn.json.gz", source: await readFile(DICTIONARY) });
    },
  };
}

// GitHub Pages serves the site under /kashiro/; KASHIRO_WEB_BASE=/ for a custom domain or Cloudflare Pages.
const webBase = process.env.KASHIRO_WEB_BASE ?? "/kashiro/";
const ICONS = fileURLToPath(new URL("./src-tauri/icons", import.meta.url));

export default defineConfig(() => ({
  plugins: web ? [webPlatform(), webDictionary(), webIcons(ICONS), webPageHead(webBase), react()] : [react()],
  base: web ? webBase : "/",
  // The web app's manifest (start_url and scope are relative to it, so they follow the base path).
  publicDir: web ? "public-web" : "public",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Tauri: keep Rust errors visible, fixed port, don't watch src-tauri
  clearScreen: false,
  // The app passes harper.js/binary (a separate .wasm) to createLinter, so the engine's fallback import
  // of the 25 MB inlined binary never runs there: keep it out of the bundle.
  build: { outDir: web ? "dist-web" : "dist", rolldownOptions: { external: ["harper.js/binaryInlined"] } },
  // The Harper Worker is bundled separately, so it needs the same exclusion; "es" lets it use import.meta and wasm URLs.
  worker: { format: "es" as const, rolldownOptions: { external: ["harper.js/binaryInlined"] } },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
