/**
 * @module plugin
 * OpenClaw plugin entry point. Registers all jeeves-watcher tools and starts
 * the managed content writer via `@karmaniverous/jeeves` core.
 */

import type { PluginApi } from '@karmaniverous/jeeves';
import {
  createComponentWriter,
  createPluginToolset,
  getPackageVersion,
  init,
  loadWorkspaceConfig,
  resolveWorkspacePath,
  WORKSPACE_CONFIG_DEFAULTS,
} from '@karmaniverous/jeeves';

import { getApiUrl, getConfigRoot } from './helpers.js';
import { createWatcherComponent } from './watcherComponent.js';
import { registerWatcherTools } from './watcherTools.js';

const PLUGIN_VERSION = getPackageVersion(import.meta.url);

/** Detect test environments to avoid timers and filesystem writes. */
function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined;
}

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  const apiUrl = getApiUrl(api);

  const component = createWatcherComponent({
    apiUrl,
    pluginVersion: PLUGIN_VERSION,
  });

  // 4 standard tools from core factory: watcher_status, watcher_config,
  // watcher_config_apply, watcher_service.
  for (const tool of createPluginToolset(component)) {
    api.registerTool(tool, { optional: true });
  }

  // 7 domain-specific tools: watcher_search, watcher_enrich,
  // watcher_validate, watcher_reindex, watcher_scan, watcher_issues,
  // watcher_walk.
  registerWatcherTools(api, apiUrl);

  // Avoid timers + filesystem writes in unit tests.
  if (isTestEnv()) return;

  const workspacePath = resolveWorkspacePath(api);

  // Initialize jeeves-core for managed content writing.
  init({
    workspacePath,
    configRoot: getConfigRoot(api),
  });

  const gatewayUrl =
    loadWorkspaceConfig(workspacePath)?.core?.gatewayUrl ??
    WORKSPACE_CONFIG_DEFAULTS.core.gatewayUrl;

  const writer = createComponentWriter(component, { gatewayUrl });
  writer.start();
}
