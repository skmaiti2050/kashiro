// Web Task 5: the web build's page head. GitHub Pages can't send headers, so the CSP is a <meta http-equiv> that only
// the web build adds (vite.config.ts), with the manifest link and theme colour of the installable app.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTENT_SECURITY_POLICY, webPageHead } from '../../scripts/webBuild';

const SOURCE = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const EXACT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

function transformed(base: string): string {
  const transform = webPageHead(base).transformIndexHtml as (html: string) => string;
  return transform(SOURCE);
}

describe('the web page head', () => {
  it('is the exact policy from the plan', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(EXACT_CSP);
  });

  it('puts the CSP meta first in <head>, before any style or script', () => {
    const html = transformed('/kashiro/');
    const meta = `<meta http-equiv="Content-Security-Policy" content="${EXACT_CSP}">`;
    expect(html).toContain(meta);
    const head = html.slice(html.indexOf('<head>') + '<head>'.length).trimStart();
    expect(head.startsWith(meta)).toBe(true);
  });

  it('links the manifest under the base path and sets the theme colour', () => {
    const html = transformed('/kashiro/');
    expect(html).toContain('<link rel="manifest" href="/kashiro/manifest.webmanifest">');
    expect(html).toContain('<meta name="theme-color" content="#1E2328">');
  });

  it('follows another base (KASHIRO_WEB_BASE=/)', () => {
    expect(transformed('/')).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  });

  it('the desktop page has no CSP meta (Tauri sets its CSP in tauri.conf.json)', () => {
    expect(SOURCE).not.toContain('Content-Security-Policy');
  });
});
