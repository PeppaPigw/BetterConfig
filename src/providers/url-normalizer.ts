const ENDPOINT_SUFFIXES = [
  '/v1/chat/completions',
  '/chat/completions',
  '/v1/responses',
  '/responses',
  '/v1/models',
  '/models',
  '/v1/embeddings',
  '/embeddings',
  '/v1/completions',
  '/completions',
];

export function buildCandidateBaseUrls(input: string): string[] {
  const normalized = normalizeInput(input);
  const stripped = stripKnownEndpoint(normalized).replace(/\/v1\/v1$/i, '/v1');
  const candidates = new Set<string>();

  const url = new URL(stripped);
  const basePath = url.pathname.replace(/\/+$/, '');
  const withoutV1 = basePath.replace(/\/v1$/i, '') || '/';
  const withV1 = withoutV1 === '/' ? '/v1' : `${withoutV1}/v1`;

  candidates.add(`${url.origin}${basePath === '/' ? '' : basePath}`);
  candidates.add(`${url.origin}${withV1}`);
  candidates.add(`${url.origin}${withoutV1 === '/' ? '' : withoutV1}`);

  return [...candidates]
    .map((item) => item.replace(/\/$/, ''))
    .filter(Boolean)
    .sort((left, right) => scoreCandidate(right) - scoreCandidate(left));
}

function normalizeInput(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^(localhost|127\.0\.0\.1|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

function stripKnownEndpoint(input: string): string {
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (input.endsWith(suffix)) {
      return input.slice(0, -suffix.length) + (suffix.startsWith('/v1/') ? '/v1' : '');
    }
  }
  return input;
}

function scoreCandidate(candidate: string): number {
  return candidate.endsWith('/v1') ? 2 : 1;
}
