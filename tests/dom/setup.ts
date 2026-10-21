import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React's act() warnings are only silenced when it knows it runs under a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout: CodeMirror measures text with these, so give it empty boxes.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
const emptyRect = () => new DOMRect(0, 0, 0, 0);
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= emptyRect;
Element.prototype.scrollIntoView ??= () => {};
// axe-core probes a canvas (icon fonts, contrast); jsdom has none and would log "Not implemented".
HTMLCanvasElement.prototype.getContext = () => null;

// harper.js fetches its 25 MB inlined WASM from a data: URL. Under jsdom, URL is jsdom's pure-JS parser,
// which takes minutes on that string, so data: URLs are decoded here directly.
const DATA_URL = /^data:([^;,]+);base64,/;
const nodeFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const header = typeof input === 'string' ? DATA_URL.exec(input.slice(0, 64)) : null;
  if (!header || typeof input !== 'string') return nodeFetch(input, init);
  const bytes = Buffer.from(input.slice(header[0].length), 'base64');
  return Promise.resolve(new Response(bytes, { headers: { 'content-type': header[1] } }));
};

afterEach(() => cleanup());
