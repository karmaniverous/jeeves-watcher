/**
 * @module plugin
 * OpenClaw plugin entry point. Registers all jeeves-watcher tools and starts
 * the managed content writer via `@karmaniverous/jeeves` core.
 */

import { createRequire } from 'node:module';

import { createComponentWriter, init } from '@karmaniverous/jeeves';

import type { PluginApi } from './helpers.js';
import { getApiUrl, getConfigRoot } from './helpers.js';
import { createWatcherComponent } from './watcherComponent.js';
import { registerWatcherTools } from './watcherTools.js';

/**
 * Read the plugin version from the nearest package.json.
 *
 * @remarks
 * Uses `createRequire(import.meta.url)` — the same pattern as
 * `@karmaniverous/jeeves` core. Works whether executed from
 * `src/index.ts` (dev/test) or `dist/index.js` (built), since
 * both are exactly one directory level below `package.json`.
 */
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
const PLUGIN_VERSION: string = pkg.version;

/** Resolve the workspace root from the OpenClaw plugin API. */
function resolveWorkspacePath(api: PluginApi): string {
  if (typeof api.resolvePath === 'function') {
    return api.resolvePath('.');
  }
  return process.cwd();
}

/** Detect test environments to avoid timers and filesystem writes. */
function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined;
}

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  const apiUrl = getApiUrl(api);
  registerWatcherTools(api, apiUrl);

  // Avoid timers + filesystem writes in unit tests.
  if (isTestEnv()) return;

  // Initialize jeeves-core for managed content writing.
  init({
    workspacePath: resolveWorkspacePath(api),
    configRoot: getConfigRoot(api),
  });

  const component = createWatcherComponent({
    apiUrl,
    pluginVersion: PLUGIN_VERSION,
  });

  const writer = createComponentWriter(component, { probeTimeoutMs: 1500 });
  writer.start();
}
