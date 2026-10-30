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

import { getPackageVersion, type PluginApi } from '@karmaniverous/jeeves';

import { createCatalogTools } from './catalogTools.js';
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

/** The standard tools, in their 0.17.0 registration order. */
const STANDARD_TOOLS = [
  'watcher_status',
  'watcher_service',
  'watcher_config',
  'watcher_config_apply',
] as const;

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  warnIfConfigRootUnset(api);

  const toolApi = withGuardedTools(api, createLazyCore(api));
  const component = createWatcherComponent(PLUGIN_VERSION);

  // Core's toolset from WATCHER_CATALOG: the 4 standard tools, plus
  // watcher_search, watcher_scan and watcher_vcs_show. Every tool resolves
  // the base URL (and, where its entry requires it, the bearer key) on each
  // call.
  const catalogTools = createCatalogTools(api, component);
  for (const name of STANDARD_TOOLS) {
    const tool = catalogTools.get(name);
    if (!tool) throw new Error(`Standard tool not built: ${name}`);
    toolApi.registerTool(tool, { optional: true });
  }

  // 14 domain-specific tools (search, enrich, scan, vcs, ...).
  registerWatcherTools(toolApi, () => getApiUrl(api), catalogTools);

  registerWatcherPromptContext(api, component);
}
