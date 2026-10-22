/**
 * SHA-256 of `data` (a string is hashed as UTF-8), in lowercase hex. Web Crypto, which Node and the
 * webview both have, so the engine stays free of platform imports.
 */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
