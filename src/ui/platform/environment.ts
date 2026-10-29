/** WebView2's version in its user agent ("… Edg/130.0.2849.80"). */
const EDGE_VERSION = /\bEdg\/([\d.]+)/;

interface UserAgentData {
  getHighEntropyValues(hints: string[]): Promise<{ platformVersion?: string }>;
}

/**
 * The Windows and WebView2 versions for Report a bug (F22 item 4), as the webview reports them; null when it
 * doesn't. Windows' "platform version" is 13 or more on Windows 11.
 */
export async function environmentVersions(): Promise<{ windows: string | null; webView2: string | null }> {
  const webView2 = EDGE_VERSION.exec(navigator.userAgent)?.[1] ?? null;
  const agentData = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  try {
    const values = await agentData?.getHighEntropyValues(['platformVersion']);
    return { windows: values?.platformVersion ?? null, webView2 };
  } catch {
    // The version is a nicety in the report; "unknown" is shown instead.
    return { windows: null, webView2 };
  }
}
