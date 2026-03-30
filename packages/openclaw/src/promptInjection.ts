import { fetchJson } from '@karmaniverous/jeeves';

import { MENU_FETCH_TIMEOUT_MS } from './constants.js';

/** Shape of the new core-convention /status response. */
interface StatusResponse {
  health?: {
    collection?: { pointCount: number };
  };
}

interface QueryResponse<T = unknown> {
  result: T[];
}

/**
 * Fetches minimal operational context from the watcher API and generates a
 * compact Markdown string suitable for injection into TOOLS.md.
 *
 * @remarks
 * We intentionally do NOT embed catalogues (rules, watched paths, ignored
 * paths). Those are available live via `watcher_config` on demand.
 *
 * When the watcher is unreachable, this function throws — the caller
 * (`createAsyncContentCache`) retains the previous successful result.
 * Core's `ComponentWriter` handles unreachable-state alerts independently.
 */
export async function generateWatcherMenu(apiUrl: string): Promise<string> {
  const scoreThresholds = { strong: 0.75, relevant: 0.5, noise: 0.25 };

  const fetchOpts = { signal: AbortSignal.timeout(MENU_FETCH_TIMEOUT_MS) };

  const [statusRes, thresholdsRes] = (await Promise.all([
    fetchJson(`${apiUrl}/status`, fetchOpts),
    fetchJson(
      `${apiUrl}/config?path=${encodeURIComponent('$.search.scoreThresholds')}`,
      fetchOpts,
    ),
  ])) as [StatusResponse, QueryResponse<Record<string, unknown>>];

  const pointCount = statusRes.health?.collection?.pointCount ?? 0;

  if (Array.isArray(thresholdsRes.result) && thresholdsRes.result.length > 0) {
    const t = thresholdsRes.result[0];
    if (typeof t.strong === 'number') scoreThresholds.strong = t.strong;
    if (typeof t.relevant === 'number') scoreThresholds.relevant = t.relevant;
    if (typeof t.noise === 'number') scoreThresholds.noise = t.noise;
  }

  const lines: string[] = [
    `This environment includes a semantic search index (\`watcher_search\`) covering ${pointCount.toLocaleString()} document chunks.`,
    '**Escalation Rule:** Use `memory_search` for personal operational notes, decisions, and rules. Escalate to `watcher_search` when memory is thin, or when searching the broader archive (tickets, docs, code). ALWAYS use `watcher_search` BEFORE filesystem commands (exec, grep) when looking for information that matches the indexed categories below.',
    '**Scan-first rule:** When a task involves structural queries (file enumeration, staleness checks, domain listing, counts), use `watcher_scan` instead of `watcher_search`. Scan does NOT use embeddings and does NOT accept a query string.',
    '**Search-first rule:** When a task involves finding, reading, or modifying files in indexed paths, run `watcher_search` FIRST — even if you already know the file path. Search surfaces related files you may not have considered and catches stale artifacts. Direct filesystem access is for acting on search results, not bypassing them.',
    '',
    '### Score Interpretation (see skill for detail):',
    `* **Strong:** >= ${String(scoreThresholds.strong)} — High confidence. Use directly.`,
    `* **Relevant:** >= ${String(scoreThresholds.relevant)} — Likely useful. Verify context before relying on it.`,
    `* **Noise:** < ${String(scoreThresholds.noise)} — Discard. If all results are noise, broaden your query or try different terms.`,
    '',
    '### On-demand inventory (use `watcher_config`):',
    '* Inference rules: `$.inferenceRules[*]`',
    '* Watched paths: `$.watch.paths[*]`',
    '* Ignored paths: `$.watch.ignored[*]`',
  ];

  return lines.join('\n');
}
