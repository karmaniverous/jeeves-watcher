/**
 * @module plugin/toolsWriter
 * Writes the Watcher menu section directly to TOOLS.md on disk.
 * Replaces the agent:bootstrap hook approach which was unreliable due to
 * OpenClaw's clearInternalHooks() wiping plugin-registered hooks on startup.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { getApiUrl, type PluginApi } from './helpers.js';
import { generateWatcherMenu } from './promptInjection.js';

const REFRESH_INTERVAL_MS = 60_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastWrittenMenu = '';

/**
 * Resolve the workspace TOOLS.md path.
 * Uses api.resolvePath if available, otherwise falls back to CWD.
 */
function resolveToolsPath(api: PluginApi): string {
  const resolvePath = (api as unknown as Record<string, unknown>)
    .resolvePath as ((input: string) => string) | undefined;
  if (typeof resolvePath === 'function') {
    return resolvePath('TOOLS.md');
  }
  return resolve(process.cwd(), 'TOOLS.md');
}

/**
 * Upsert the watcher section in TOOLS.md content.
 *
 * Strategy:
 * - If a `## Watcher` section already exists, replace it in place.
 * - Otherwise, prepend `# Jeeves Platform Tools\n\n## Watcher\n\n...`
 *   before any existing content.
 */
function upsertWatcherContent(existing: string, watcherMenu: string): string {
  const section = `## Watcher\n\n${watcherMenu}`;

  // Replace existing watcher section (match from ## Watcher to next ## or # or EOF)
  const re = /^## Watcher\n[\s\S]*?(?=\n## |\n# |$(?![\s\S]))/m;
  if (re.test(existing)) {
    return existing.replace(re, section);
  }

  // No existing section. Prepend under a platform tools H1.
  const platformH1 = '# Jeeves Platform Tools';

  if (existing.includes(platformH1)) {
    // Insert after the H1
    const idx = existing.indexOf(platformH1) + platformH1.length;
    return existing.slice(0, idx) + `\n\n${section}\n` + existing.slice(idx);
  }

  // Prepend platform header + watcher section before existing content
  const trimmed = existing.trim();
  if (trimmed.length === 0) {
    return `${platformH1}\n\n${section}\n`;
  }
  return `${platformH1}\n\n${section}\n\n${trimmed}\n`;
}

/**
 * Fetch the current watcher menu and write it to TOOLS.md if changed.
 * Returns true if the file was updated.
 */
async function refreshToolsMd(api: PluginApi): Promise<boolean> {
  const apiUrl = getApiUrl(api);
  const menu = await generateWatcherMenu(apiUrl);

  if (menu === lastWrittenMenu) {
    return false;
  }

  const toolsPath = resolveToolsPath(api);

  let current = '';
  try {
    current = await readFile(toolsPath, 'utf8');
  } catch {
    // File doesn't exist yet — we'll create it
  }

  const updated = upsertWatcherContent(current, menu);

  if (updated !== current) {
    await writeFile(toolsPath, updated, 'utf8');
    lastWrittenMenu = menu;
    return true;
  }

  lastWrittenMenu = menu;
  return false;
}

/**
 * Start the periodic TOOLS.md writer.
 * Writes immediately on startup, then refreshes every REFRESH_INTERVAL_MS.
 */
export function startToolsWriter(api: PluginApi): void {
  // Initial write (fire and forget — errors logged but not thrown)
  refreshToolsMd(api).catch((err: unknown) => {
    console.error('[jeeves-watcher] Failed to write TOOLS.md:', err);
  });

  // Periodic refresh
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }
  intervalHandle = setInterval(() => {
    refreshToolsMd(api).catch((err: unknown) => {
      console.error('[jeeves-watcher] Failed to refresh TOOLS.md:', err);
    });
  }, REFRESH_INTERVAL_MS);

  // Don't keep the process alive just for this interval
  if (typeof intervalHandle === 'object' && 'unref' in intervalHandle) {
    intervalHandle.unref();
  }
}

/**
 * Force an immediate refresh (e.g., after watcher_config_apply).
 */
export async function forceRefreshToolsMd(api: PluginApi): Promise<void> {
  lastWrittenMenu = ''; // Invalidate cache to force write
  await refreshToolsMd(api);
}

/**
 * Stop the periodic writer (for cleanup).
 */
export function stopToolsWriter(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
