/**
 * @module plugin
 * OpenClaw plugin entry point. Registers all jeeves-watcher tools.
 */

import type { PluginApi } from './helpers.js';
import { getApiUrl } from './helpers.js';
import { registerWatcherTools } from './watcherTools.js';

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  const baseUrl = getApiUrl(api);
  registerWatcherTools(api, baseUrl);
}
