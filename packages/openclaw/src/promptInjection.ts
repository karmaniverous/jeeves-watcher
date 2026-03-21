import { fetchJson } from '@karmaniverous/jeeves';

import { DEFAULT_QDRANT_URL, MENU_FETCH_TIMEOUT_MS } from './constants.js';

interface StatusResponse {
  collection?: { pointCount: number };
}

interface QueryResponse {
  result: unknown[];
}

interface InferenceRule {
  name?: string;
  description?: string;
}

/**
 * Fetches data from the watcher API and generates a Markdown menu string.
 * The string is platform-agnostic and safe to inject into TOOLS.md.
 */
export async function generateWatcherMenu(apiUrl: string): Promise<string> {
  let pointCount = 0;
  const activeRules: Array<{ name: string; description: string }> = [];
  const watchPaths: string[] = [];
  const ignoredPaths: string[] = [];
  const scoreThresholds = { strong: 0.75, relevant: 0.5, noise: 0.25 };

  try {
    const fetchOpts = { signal: AbortSignal.timeout(MENU_FETCH_TIMEOUT_MS) };
    const [statusRes, rulesRes, pathsRes, thresholdsRes, ignoredRes] =
      (await Promise.all([
        fetchJson(`${apiUrl}/status`, fetchOpts),
        fetchJson(
          `${apiUrl}/config?path=${encodeURIComponent('$.inferenceRules[*]')}`,
          fetchOpts,
        ),
        fetchJson(
          `${apiUrl}/config?path=${encodeURIComponent('$.watch.paths[*]')}`,
          fetchOpts,
        ),
        fetchJson(
          `${apiUrl}/config?path=${encodeURIComponent('$.search.scoreThresholds')}`,
          fetchOpts,
        ),
        fetchJson(
          `${apiUrl}/config?path=${encodeURIComponent('$.watch.ignored[*]')}`,
          fetchOpts,
        ),
      ])) as [
        StatusResponse,
        QueryResponse,
        QueryResponse,
        QueryResponse,
        QueryResponse,
      ];

    pointCount = statusRes.collection?.pointCount ?? 0;

    if (Array.isArray(rulesRes.result)) {
      for (const rule of rulesRes.result as InferenceRule[]) {
        if (rule.name && rule.description) {
          activeRules.push({ name: rule.name, description: rule.description });
        }
      }
    }

    if (Array.isArray(pathsRes.result)) {
      for (const p of pathsRes.result) {
        if (typeof p === 'string') {
          watchPaths.push(p);
        }
      }
    }

    if (Array.isArray(ignoredRes.result)) {
      for (const p of ignoredRes.result) {
        if (typeof p === 'string') ignoredPaths.push(p);
      }
    }

    if (
      Array.isArray(thresholdsRes.result) &&
      thresholdsRes.result.length > 0
    ) {
      const t = thresholdsRes.result[0] as Record<string, unknown>;
      if (typeof t.strong === 'number') scoreThresholds.strong = t.strong;
      if (typeof t.relevant === 'number') scoreThresholds.relevant = t.relevant;
      if (typeof t.noise === 'number') scoreThresholds.noise = t.noise;
    }
  } catch {
    let qdrantStatus = '*Unknown*';
    try {
      // Assuming Qdrant runs locally on the default port
      const res = await fetch(`${DEFAULT_QDRANT_URL}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
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
    "### What's on the menu:",
  ];

  if (activeRules.length) {
    for (const rule of activeRules) {
      lines.push(`* **${rule.name}**: ${rule.description}`);
    }
  } else {
    lines.push('* (No inference rules configured)');
  }

  lines.push('', '### Indexed paths:');

  if (watchPaths.length) {
    for (const p of watchPaths) {
      lines.push(`* \`${p}\``);
    }
  } else {
    lines.push('* (No watch paths configured)');
  }

  if (ignoredPaths.length > 0) {
    lines.push('', '### Ignored paths:');
    for (const p of ignoredPaths) {
      lines.push(`* \`${p}\``);
    }
  }

  return lines.join('\n');
}
