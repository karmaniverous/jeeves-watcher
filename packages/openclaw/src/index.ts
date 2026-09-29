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

  // 4 standard tools from core factory: watcher_status, watcher_config,
  // watcher_config_apply, watcher_service. `apiUrl` is resolved lazily on
  // every call, so the HTTP tools honour the configured URL (defaultPort is
  // only core's fallback).
  for (const tool of createPluginToolset(
    createWatcherComponent(PLUGIN_VERSION),
    { apiUrl: () => getApiUrl(api) },
  )) {
    toolApi.registerTool(tool, { optional: true });
  }

  // 14 domain-specific tools (search, enrich, scan, vcs, ...).
  registerWatcherTools(toolApi, getApiUrl(api));

  registerWatcherPromptContext(api);
}
