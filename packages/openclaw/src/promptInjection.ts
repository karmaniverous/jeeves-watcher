import { fetchJson, fetchWithTimeout } from '@karmaniverous/jeeves';

import { DEFAULT_QDRANT_URL, MENU_FETCH_TIMEOUT_MS } from './constants.js';

interface StatusResponse {
  collection?: { pointCount: number };
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
 */
export async function generateWatcherMenu(apiUrl: string): Promise<string> {
  let pointCount = 0;
  const scoreThresholds = { strong: 0.75, relevant: 0.5, noise: 0.25 };

  try {
    const fetchOpts = { signal: AbortSignal.timeout(MENU_FETCH_TIMEOUT_MS) };

    const [statusRes, thresholdsRes] = (await Promise.all([
      fetchJson(`${apiUrl}/status`, fetchOpts),
      fetchJson(
        `${apiUrl}/config?path=${encodeURIComponent('$.search.scoreThresholds')}`,
        fetchOpts,
      ),
    ])) as [StatusResponse, QueryResponse<Record<string, unknown>>];

    pointCount = statusRes.collection?.pointCount ?? 0;

    if (
      Array.isArray(thresholdsRes.result) &&
      thresholdsRes.result.length > 0
    ) {
      const t = thresholdsRes.result[0];
      if (typeof t.strong === 'number') scoreThresholds.strong = t.strong;
      if (typeof t.relevant === 'number') scoreThresholds.relevant = t.relevant;
      if (typeof t.noise === 'number') scoreThresholds.noise = t.noise;
    }
  } catch {
    let qdrantStatus = '*Unknown*';
    try {
      // Assuming Qdrant runs locally on the default port
      const res = await fetchWithTimeout(`${DEFAULT_QDRANT_URL}/healthz`, 1000);
      qdrantStatus = res.ok ? 'Running' : 'Error';
    } catch {
      qdrantStatus = 'Down / Unreachable';
    }

    return `> **ACTION REQUIRED: Watcher service is unreachable.**
> The jeeves-watcher service API at ${apiUrl} is down or not installed.
> **Diagnostic Info:**
> - Watcher API (${apiUrl}): Unreachable
> - Qdrant (${DEFAULT_QDRANT_URL}): ${qdrantStatus}
>
> **DO NOT** ignore this. Read the \`jeeves-watcher\` skill's **Bootstrap** section immediately and walk the user through the setup process. Use the diagnostic info above to determine if Qdrant needs installing/starting, or if only the watcher service needs attention.`;
  }

  if (pointCount === 0) {
    return `> **ACTION REQUIRED: Watcher service is empty.**
> The jeeves-watcher service is running at ${apiUrl} but has no indexed data.
> The service has either just been installed (no configuration/data), or indexing hasn't run.
>
> **DO NOT** ignore this. Read the \`jeeves-watcher\` skill's **Bootstrap** section immediately and walk the user through the setup process to configure and reindex the workspace.`;
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
