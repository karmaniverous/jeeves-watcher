/**
 * Watcher-specific convenience wrappers over `@karmaniverous/jeeves` core SDK.
 *
 * @remarks
 * Only watcher-specific resolution logic lives here. Core SDK types and
 * utilities (`PluginApi`, `ToolResult`, `ok`, `connectionFail`, `fetchJson`,
 * `postJson`) should be imported directly from `@karmaniverous/jeeves`.
 *
 * @module plugin/helpers
 */

import { type PluginApi, resolvePluginSetting } from '@karmaniverous/jeeves';

import {
  DEFAULT_API_URL,
  DEFAULT_CONFIG_ROOT,
  PLUGIN_ID,
} from './constants.js';

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
