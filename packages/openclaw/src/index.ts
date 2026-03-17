/**
 * @module plugin
 * OpenClaw plugin entry point. Registers all jeeves-watcher tools.
 *
 * @remarks
 * Core library (`@karmaniverous/jeeves`) is loaded dynamically so that tool
 * registration succeeds even if the core has import-time issues (e.g., the
 * v0.1.0 `createRequire` path bug). Tool registration is the plugin's primary
 * responsibility; the managed content writer is a secondary enhancement.
 */

import type { PluginApi } from './helpers.js';
import { getApiUrl, getConfigRoot } from './helpers.js';
import { registerWatcherTools } from './watcherTools.js';

const PLUGIN_VERSION = '0.7.0';

function resolveWorkspacePath(api: PluginApi): string {
  if (typeof api.resolvePath === 'function') {
    return api.resolvePath('.');
  }
  return process.cwd();
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined;
}

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  const apiUrl = getApiUrl(api);
  registerWatcherTools(api, apiUrl);

  // Avoid timers + filesystem writes in unit tests.
  if (isTestEnv()) return;

  // Start the managed content writer asynchronously.
  // Dynamic import isolates the core dependency so tool registration
  // is never blocked by import-time failures in @karmaniverous/jeeves.
  void startWriter(api, apiUrl);
}

async function startWriter(api: PluginApi, apiUrl: string): Promise<void> {
  try {
    const { init, createComponentWriter } =
      await import('@karmaniverous/jeeves');
    const { createWatcherComponent } = await import('./watcherComponent.js');

    init({
      workspacePath: resolveWorkspacePath(api),
      configRoot: getConfigRoot(api),
    });

    const { component, prime } = createWatcherComponent({
      apiUrl,
      pluginVersion: PLUGIN_VERSION,
    });

    const writer = createComponentWriter(component, { probeTimeoutMs: 1500 });

    await prime;
    writer.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[jeeves-watcher] Failed to start managed writer: ${msg}`);
  }
}
