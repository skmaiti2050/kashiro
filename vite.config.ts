import { defineConfig, normalizePath, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

export default defineConfig(() => ({
  plugins: web ? [webPlatform(), react()] : [react()],
  // GitHub Pages serves the site under /kashiro/; KASHIRO_WEB_BASE=/ for a custom domain or Cloudflare Pages.
  base: web ? (process.env.KASHIRO_WEB_BASE ?? "/kashiro/") : "/",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Tauri: keep Rust errors visible, fixed port, don't watch src-tauri
  clearScreen: false,
  // The app passes harper.js/binary (a separate .wasm) to createLinter, so the engine's fallback import
  // of the 25 MB inlined binary never runs there: keep it out of the bundle.
  build: { outDir: web ? "dist-web" : "dist", rolldownOptions: { external: ["harper.js/binaryInlined"] } },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
