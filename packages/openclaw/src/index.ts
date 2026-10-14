/**
 * @module plugin
 * OpenClaw plugin entry point. Registers the jeeves-watcher tools and the
 * always-in-context watcher rules.
 *
 * @remarks
 * A standard OpenClaw plugin on `@karmaniverous/jeeves` core: it writes no
 * workspace files and starts no timers. Registration never requires
 * `configRoot`; it is resolved lazily when a gated tool runs (see
 * `lazyCore`). Only invocations that read `configRoot` (`CONFIG_ROOT_READERS`:
 * `watcher_service install`) are gated; HTTP-only tools work without it.
 */

import {
  createPluginToolset,
  getPackageVersion,
  type PluginApi,
} from '@karmaniverous/jeeves';

import { registerApiTool } from './apiTool.js';
import { configToolConfigs, CORE_TOOLS_REPLACED } from './configTools.js';
import { getApiUrl } from './helpers.js';
import {
  createLazyCore,
  warnIfConfigRootUnset,
  withGuardedTools,
} from './lazyCore.js';
import { registerWatcherPromptContext } from './promptContext.js';
import { createWatcherComponent } from './watcherComponent.js';
import { registerWatcherTools } from './watcherTools.js';

const PLUGIN_VERSION = getPackageVersion(import.meta.url);

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  warnIfConfigRootUnset(api);

  const toolApi = withGuardedTools(api, createLazyCore(api));

  // 4 standard tools: watcher_status and watcher_service from the core
  // factory; watcher_config and watcher_config_apply re-implemented here so
  // they send the bearer key (core cannot attach headers). `apiUrl` is
  // resolved lazily on every call by every tool (defaultPort is only core's
  // fallback).
  for (const tool of createPluginToolset(
    createWatcherComponent(PLUGIN_VERSION),
    { apiUrl: () => getApiUrl(api) },
  )) {
    if (!CORE_TOOLS_REPLACED.has(tool.name)) {
      toolApi.registerTool(tool, { optional: true });
    }
  }
  for (const config of configToolConfigs) {
    registerApiTool(toolApi, () => getApiUrl(api), config);
  }

  // 14 domain-specific tools (search, enrich, scan, vcs, ...).
  registerWatcherTools(toolApi, () => getApiUrl(api));

  registerWatcherPromptContext(api);
}
