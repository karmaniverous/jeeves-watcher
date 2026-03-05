/**
 * @module plugin
 * OpenClaw plugin entry point. Registers all jeeves-watcher tools.
 */

import type { PluginApi } from './helpers.js';
import { getApiUrl } from './helpers.js';
import { startToolsWriter } from './toolsWriter.js';
import { registerWatcherTools } from './watcherTools.js';

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  const baseUrl = getApiUrl(api);
  registerWatcherTools(api, baseUrl);

  // Write the watcher menu to TOOLS.md on disk, refreshing periodically.
  // This replaces the agent:bootstrap hook approach which was unreliable
  // because OpenClaw's clearInternalHooks() wipes plugin-registered hooks
  // during the async startup sequence.
  startToolsWriter(api);
}
