import {
  fetchJson,
  getApiUrl,
  getCacheTtlMs,
  type PluginApi,
} from './helpers.js';

/** Cache structure for the generated menu string */
interface MenuCache {
  value: string;
  expiresAt: number;
}

let menuCache: MenuCache | null = null;

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

type BootstrapFile = {
  name: string;
  path?: string;
  content?: string;
  missing: boolean;
};

type AgentBootstrapEventContext = {
  bootstrapFiles: BootstrapFile[];
};

function isAgentBootstrapEventContext(
  value: unknown,
): value is AgentBootstrapEventContext {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as { bootstrapFiles?: unknown };
  return Array.isArray(v.bootstrapFiles);
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
    const [statusRes, rulesRes, pathsRes, thresholdsRes, ignoredRes] =
      (await Promise.all([
        fetchJson(`${apiUrl}/status`),
        fetchJson(
          `${apiUrl}/config?path=${encodeURIComponent('$.inferenceRules[*]')}`,
        ),
        fetchJson(
          `${apiUrl}/config?path=${encodeURIComponent('$.watch.paths[*]')}`,
        ),
        fetchJson(
          `${apiUrl}/config?path=${encodeURIComponent('$.search.scoreThresholds')}`,
        ),
        fetchJson(
          `${apiUrl}/config?path=${encodeURIComponent('$.watch.ignored[*]')}`,
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
      const res = await fetch('http://127.0.0.1:6333/healthz', {
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
> - Qdrant (http://127.0.0.1:6333): ${qdrantStatus}
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

async function getCachedWatcherMenu(
  apiUrl: string,
  ttlMs: number,
): Promise<string> {
  const now = Date.now();
  if (menuCache && menuCache.expiresAt > now) {
    return menuCache.value;
  }

  const menu = await generateWatcherMenu(apiUrl);
  menuCache = { value: menu, expiresAt: now + ttlMs };
  return menu;
}

function ensurePlatformToolsSection(toolsMd: string): string {
  if (toolsMd.includes('# Jeeves Platform Tools')) {
    return toolsMd;
  }
  return `# Jeeves Platform Tools\n\n${toolsMd}`;
}

function upsertWatcherSection(toolsMd: string, watcherMenu: string): string {
  const section = `## Watcher\n\n${watcherMenu}\n`;

  // If we already injected a Watcher section, replace it.
  // The `m` flag is needed so `^` matches line starts, but it also makes
  // `$` match end-of-line instead of end-of-string.  Use a negative
  // lookahead `$(?![\s\S])` to anchor at true end-of-string.
  const re = /^## Watcher\n[\s\S]*?(?=\n## |\n# |$(?![\s\S]))/m;
  if (re.test(toolsMd)) {
    return toolsMd.replace(re, section);
  }

  // Otherwise insert immediately after the H1 if present, else append.
  const h1 = '# Jeeves Platform Tools';
  const idx = toolsMd.indexOf(h1);
  if (idx !== -1) {
    const afterH1 = idx + h1.length;
    return (
      toolsMd.slice(0, afterH1) + `\n\n${section}` + toolsMd.slice(afterH1)
    );
  }

  return `${toolsMd}\n\n${section}`;
}

/**
 * Hook handler for agent:bootstrap.
 * Injects/updates the Watcher Menu into the TOOLS.md payload.
 */
export async function handleAgentBootstrap(
  event: unknown,
  api: PluginApi,
): Promise<void> {
  const context = (event as { context?: unknown } | null)?.context;
  if (!isAgentBootstrapEventContext(context)) {
    return;
  }

  const apiUrl = getApiUrl(api);
  const cacheTtlMs = getCacheTtlMs(api);
  const watcherMenu = await getCachedWatcherMenu(apiUrl, cacheTtlMs);

  let toolsFile = context.bootstrapFiles.find((f) => f.name === 'TOOLS.md');

  if (!toolsFile) {
    toolsFile = { name: 'TOOLS.md', content: '', missing: false };
    context.bootstrapFiles.push(toolsFile);
  }

  const current = toolsFile.content ?? '';

  // Guard: the bootstrap hook fires on every message turn because OpenClaw
  // caches bootstrapFiles per session and returns the same mutable objects.
  // If we already injected the watcher menu into this content, skip to
  // avoid accumulating duplicate sections.
  if (current.includes('## Watcher') && current.includes(watcherMenu)) {
    return;
  }

  const withH1 = ensurePlatformToolsSection(current);
  const updated = upsertWatcherSection(withH1, watcherMenu);

  toolsFile.content = updated;
}
