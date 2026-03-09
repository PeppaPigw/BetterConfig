import { buildCandidateBaseUrls } from './url-normalizer.js';

export interface ProbeOptions {
  inputUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export type ProbeResult =
  | { ok: true; baseUrl: string; models: string[] }
  | { ok: false; error: { category: 'auth' | 'url' | 'network' | 'unknown'; message: string } };

export async function probeOpenAICompatibleProvider(options: ProbeOptions): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates = buildCandidateBaseUrls(options.inputUrl);
  let lastError: ProbeResult | undefined;

  for (const baseUrl of candidates) {
    try {
      const response = await fetchImpl(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          Accept: 'application/json',
        },
      });

      const contentType = response.headers.get('content-type') ?? '';
      if (response.status === 401) {
        lastError = { ok: false, error: { category: 'auth', message: 'The API key was rejected by the server (401 Unauthorized).' } };
        continue;
      }
      if (response.status === 403) {
        lastError = { ok: false, error: { category: 'auth', message: 'Access was denied by the server (403 Forbidden). The key may lack the required permissions.' } };
        continue;
      }
      if (response.status === 404) {
        lastError = { ok: false, error: { category: 'url', message: 'The server responded with 404 for the detected base URL.' } };
        continue;
      }
      if (!contentType.includes('json')) {
        lastError = { ok: false, error: { category: 'url', message: 'The endpoint returned non-JSON content, so it is probably not an API base URL.' } };
        continue;
      }
      if (!response.ok) {
        lastError = { ok: false, error: { category: 'unknown', message: `The server returned ${response.status}.` } };
        continue;
      }

      const payload = (await response.json()) as { data?: Array<{ id?: string }> };
      const models = [...new Set((payload.data ?? []).map((item) => item.id).filter((item): item is string => Boolean(item)))].sort();
      return { ok: true, baseUrl, models };
    } catch (error) {
      lastError = { ok: false, error: { category: 'network', message: error instanceof Error ? error.message : String(error) } };
    }
  }

  return lastError ?? { ok: false, error: { category: 'unknown', message: 'No candidate base URL succeeded.' } };
}
