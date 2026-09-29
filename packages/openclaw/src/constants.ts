/**
 * @module plugin/constants
 * Shared constants for the OpenClaw plugin package.
 */

import { DEFAULT_PORT as _DEFAULT_PORT } from '@karmaniverous/jeeves-watcher-core';

export {
  COMPONENT_NAME,
  DEFAULT_PORT,
  PLUGIN_PACKAGE,
  SERVICE_PACKAGE,
} from '@karmaniverous/jeeves-watcher-core';

/** Plugin identifier used in OpenClaw config (`plugins.entries.<id>`). */
export const PLUGIN_ID = 'jeeves-watcher-openclaw';

/** Default watcher API base URL. */
export const DEFAULT_API_URL = `http://127.0.0.1:${String(_DEFAULT_PORT)}`;

/** Environment variable consulted when plugin config has no `configRoot`. */
export const CONFIG_ROOT_ENV_VAR = 'JEEVES_CONFIG_ROOT';

/**
 * Tool error returned when `configRoot` cannot be resolved.
 *
 * @remarks
 * There is deliberately no default config root: a hard-coded path is only
 * correct on one installation (see #227).
 */
export const CONFIG_ROOT_NOT_CONFIGURED = `configRoot not configured — set it in plugin config (plugins.entries.${PLUGIN_ID}.config.configRoot) or via ${CONFIG_ROOT_ENV_VAR} env var`;

/** Warning logged once at registration when `configRoot` is unset. */
export const CONFIG_ROOT_UNSET_WARNING = `[${PLUGIN_ID}] configRoot not configured yet — watcher_service install will be unavailable until it is set in plugin config or ${CONFIG_ROOT_ENV_VAR} (HTTP API tools are unaffected)`;
