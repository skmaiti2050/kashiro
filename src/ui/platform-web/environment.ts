import type * as desktop from '../platform/environment';

/** A browser brand ("Google Chrome", "130"), from navigator.userAgentData (Chromium browsers only). */
interface Brand {
  brand: string;
  version: string;
}

/** The made-up brand Chromium adds so sites can't rely on the list ("Not)A;Brand", "Not_A Brand"). */
const MADE_UP_BRAND = /^Not.A.Brand$/i;

/** "Google Chrome 130": the first real brand that isn't the Chromium engine underneath, else Chromium; "unknown" without brands. */
function browserName(brands: readonly Brand[] | undefined): string {
  const real = (brands ?? []).filter((b) => !MADE_UP_BRAND.test(b.brand));
  const named = real.find((b) => b.brand !== 'Chromium') ?? real[0];
  return named ? `${named.brand} ${named.version}` : 'unknown';
}

/** Report a bug on the web: the browser, never Windows or WebView2 (the desktop app's lines). */
export const environmentVersions: typeof desktop.environmentVersions = async () => {
  const agentData = (navigator as Navigator & { userAgentData?: { brands?: readonly Brand[] } }).userAgentData;
  return { windows: null, webView2: null, browser: browserName(agentData?.brands) };
};
