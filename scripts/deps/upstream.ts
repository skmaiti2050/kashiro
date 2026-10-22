/**
 * Best-effort check for newer releases of the pinned data files (deps:status, Task S8). The only network
 * use in this repository besides installing tools; the app never calls it.
 */
import type { Asset } from './assets';

const TIMEOUT_MS = 15_000;

export type UpstreamResult = { id: string; latest: string; current: string | null; update: boolean } | { id: string; error: string };

/** URL to ask and how to read the release out of its JSON answer, per upstream kind. */
function query(upstream: Asset['upstream']): { url: string; read: (json: Record<string, unknown>) => string } | undefined {
  switch (upstream.kind) {
    case 'github-release':
      return { url: `https://api.github.com/repos/${upstream.repo}/releases/latest`, read: (json) => String(json.tag_name) };
    case 'pypi':
      return { url: `https://pypi.org/pypi/${upstream.package}/json`, read: (json) => String((json.info as { version: string }).version) };
    case 'huggingface-dataset':
      return { url: `https://huggingface.co/api/datasets/${upstream.dataset}`, read: (json) => String(json.lastModified).slice(0, 10) };
    default:
      return undefined;
  }
}

export async function checkUpstream(asset: Asset, fetchFn: typeof fetch = fetch): Promise<UpstreamResult> {
  const request = query(asset.upstream);
  if (!request) return { id: asset.id, error: `no upstream to check (${asset.upstream.kind})` };
  try {
    const response = await fetchFn(request.url, {
      headers: { accept: 'application/json', 'user-agent': 'writing-check-deps-status' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { id: asset.id, error: `HTTP ${response.status} from ${request.url}` };
    const latest = request.read((await response.json()) as Record<string, unknown>);
    const current = asset.upstream.current ?? null;
    // Nothing pinned yet (a planned asset): the latest release is information, not an update.
    return { id: asset.id, latest, current, update: current !== null && latest !== current };
  } catch (error) {
    return { id: asset.id, error: `${request.url}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
