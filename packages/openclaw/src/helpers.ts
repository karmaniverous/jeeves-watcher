/**
 * Watcher-specific convenience wrappers over `@karmaniverous/jeeves` core SDK.
 *
 * @module plugin/helpers
 */

import { type PluginApi, resolvePluginSetting } from '@karmaniverous/jeeves';

import {
  DEFAULT_API_URL,
  DEFAULT_CONFIG_ROOT,
  PLUGIN_ID,
} from './constants.js';

export type { PluginApi, ToolResult } from '@karmaniverous/jeeves';
export { connectionFail, fetchJson, ok, postJson } from '@karmaniverous/jeeves';

/** Resolve the watcher API base URL. */
export function getApiUrl(api: PluginApi): string {
  return resolvePluginSetting(
    api,
    PLUGIN_ID,
    'apiUrl',
    'JEEVES_WATCHER_URL',
    DEFAULT_API_URL,
  );
}

/** Resolve the platform config root path. */
export function getConfigRoot(api: PluginApi): string {
  return resolvePluginSetting(
    api,
    PLUGIN_ID,
    'configRoot',
    'JEEVES_CONFIG_ROOT',
    DEFAULT_CONFIG_ROOT,
  );
}
