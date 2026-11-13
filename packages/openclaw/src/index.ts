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

import {
  createCatalogTools,
  registerCatalogTool,
  WATCHER_TOOL_NAMES,
} from './catalogTools.js';
import {
  createLazyCore,
  warnIfConfigRootUnset,
  withGuardedTools,
} from './lazyCore.js';
import { registerWatcherPromptContext } from './promptContext.js';
import { createWatcherComponent } from './watcherComponent.js';

const PLUGIN_VERSION = getPackageVersion(import.meta.url);

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  warnIfConfigRootUnset(api);

  const toolApi = withGuardedTools(api, createLazyCore(api));
  const component = createWatcherComponent(PLUGIN_VERSION);

  // Every tool comes from core's toolset over WATCHER_CATALOG (D38): the 4
  // standard tools and the 18 domain tools: the 14 in their 0.17.0 order,
  // then the four of D206. Each
  // resolves the base URL (and, where its entry requires it, the bearer key)
  // on every call.
  const catalogTools = createCatalogTools(api, component);
  for (const name of WATCHER_TOOL_NAMES) {
    registerCatalogTool(toolApi, catalogTools, name);
  }

  registerWatcherPromptContext(api, component);
}
