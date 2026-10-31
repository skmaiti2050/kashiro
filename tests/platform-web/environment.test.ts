// @vitest-environment jsdom
// Web Task 4: Report a bug names the browser (from navigator.userAgentData's brands), not Windows or WebView2.
import { afterEach, describe, expect, it } from 'vitest';
import { environmentVersions } from '@/ui/platform-web/environment';

function setBrands(brands: { brand: string; version: string }[] | null): void {
  Object.defineProperty(navigator, 'userAgentData', { value: brands === null ? undefined : { brands }, configurable: true });
}

afterEach(() => setBrands(null));

describe('the browser for Report a bug', () => {
  it('names the browser brand, skipping Chromium and the made-up "Not A Brand" entry', async () => {
    setBrands([
      { brand: 'Not)A;Brand', version: '99' },
      { brand: 'Google Chrome', version: '130' },
      { brand: 'Chromium', version: '130' },
    ]);
    expect(await environmentVersions()).toEqual({ windows: null, webView2: null, browser: 'Google Chrome 130' });
  });

  it('Chromium itself, when it is the only real brand', async () => {
    setBrands([
      { brand: 'Chromium', version: '131' },
      { brand: 'Not_A Brand', version: '24' },
    ]);
    expect((await environmentVersions()).browser).toBe('Chromium 131');
  });

  it('"unknown" when the browser gives no brands (Firefox, Safari)', async () => {
    expect((await environmentVersions()).browser).toBe('unknown');
  });
});
