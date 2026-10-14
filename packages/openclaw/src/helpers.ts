/**
 * Watcher-specific convenience wrappers over `@karmaniverous/jeeves` core SDK.
 *
 * @remarks
 * Only watcher-specific resolution logic (API URL, API key, config root)
 * lives here. Core SDK types and utilities (`PluginApi`, `ToolResult`, `ok`,
 * `connectionFail`) should be imported directly from `@karmaniverous/jeeves`;
 * watcher API requests go through `requestJson` (`./http.js`).
 *
 * @module plugin/helpers
 */

import {
  type PluginApi,
  resolveOptionalPluginSetting,
  resolvePluginSetting,
} from '@karmaniverous/jeeves';

import {
  API_KEY_ENV_VAR,
  CONFIG_ROOT_ENV_VAR,
  DEFAULT_API_URL,
  PLUGIN_ID,
} from './constants.js';

/**
 * Resolve the watcher API base URL.
 *
 * @remarks
 * Resolution order: plugin-scoped config (`api.pluginConfig`), then
 * `plugins.entries.<id>.config`, then `JEEVES_WATCHER_URL`, then
 * `DEFAULT_API_URL`. Safe to call per tool invocation.
 */
export function getApiUrl(api: PluginApi): string {
  const scoped = api.pluginConfig?.apiUrl;
  if (typeof scoped === 'string' && scoped.trim() !== '') return scoped;

  return resolvePluginSetting(
    api,
    PLUGIN_ID,
    'apiUrl',
    'JEEVES_WATCHER_URL',
    DEFAULT_API_URL,
  );
}

/**
 * Resolve the watcher API bearer key, if configured.
 *
 * @remarks
 * Resolution order: plugin-scoped config (`api.pluginConfig.apiKey`), then
 * `plugins.entries.<id>.config.apiKey`, then `JEEVES_WATCHER_API_KEY`. Blank
 * values count as unset. Resolved per request; never logged.
 *
 * @returns The key, or `undefined` when unset (requests carry no header).
 */
export function getApiKey(api: PluginApi): string | undefined {
  const scoped = api.pluginConfig?.apiKey;
  if (typeof scoped === 'string' && scoped.trim() !== '') return scoped;

  const resolved = resolveOptionalPluginSetting(
    api,
    PLUGIN_ID,
    'apiKey',
    API_KEY_ENV_VAR,
  );
  return resolved?.trim() ? resolved : undefined;
}

/**
 * Resolve the platform config root path, if configured.
 *
 * @remarks
 * Resolution order: plugin-scoped config (`api.pluginConfig`), then
 * `plugins.entries.<id>.config`, then `JEEVES_CONFIG_ROOT`. There is no
 * default. Call this lazily (at tool invocation), never to gate
 * registration: `openclaw plugins install` activates the plugin before
 * `jeeves install` writes its config.
 *
 * @returns The config root, or `undefined` when unset.
 */
export function getConfigRoot(api: PluginApi): string | undefined {
  const scoped = api.pluginConfig?.configRoot;
  if (typeof scoped === 'string' && scoped.trim() !== '') return scoped;

  const resolved = resolveOptionalPluginSetting(
    api,
    PLUGIN_ID,
    'configRoot',
    CONFIG_ROOT_ENV_VAR,
  );
  return resolved?.trim() ? resolved : undefined;
}
