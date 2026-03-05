/**
 * @module plugin
 * OpenClaw plugin entry point. Registers all jeeves-watcher tools.
 */

import type { PluginApi } from './helpers.js';
import { getApiUrl } from './helpers.js';
import { handleAgentBootstrap } from './promptInjection.js';
import { registerWatcherTools } from './watcherTools.js';

/** Register all jeeves-watcher tools with the OpenClaw plugin API. */
export default function register(api: PluginApi): void {
  const baseUrl = getApiUrl(api);
  registerWatcherTools(api, baseUrl);

  // Register the agent:bootstrap hook if the host OpenClaw version supports it
  const registerHook = api.registerHook;
  if (typeof registerHook === 'function') {
    registerHook('agent:bootstrap', async (event) => {
      await handleAgentBootstrap(event, api);
    }, { name: 'jeeves-watcher-openclaw' });
  }
}
