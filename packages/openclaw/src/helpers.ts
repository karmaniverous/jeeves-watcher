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

import {
  type PluginApi,
  resolveOptionalPluginSetting,
  resolvePluginSetting,
} from '@karmaniverous/jeeves';

import {
  CONFIG_ROOT_ENV_VAR,
  DEFAULT_API_URL,
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
