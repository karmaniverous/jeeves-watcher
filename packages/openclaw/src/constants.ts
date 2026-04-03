/**
 * @module plugin/constants
 * Shared constants for the OpenClaw plugin package.
 *
 * @remarks
 * Imported by both the plugin bundle (`index.ts`) and the CLI bundle
 * (`cli.ts`). Rollup inlines these into each output independently.
 */

import { DEFAULT_PORTS } from '@karmaniverous/jeeves';

/** Component name shared across service and plugin descriptors. */
export const COMPONENT_NAME = 'watcher';

/** Plugin identifier used in OpenClaw config and extensions directory. */
export const PLUGIN_ID = 'jeeves-watcher-openclaw';

/** npm package name for the service. */
export const SERVICE_PACKAGE = '@karmaniverous/jeeves-watcher';

/** npm package name for the plugin. */
export const PLUGIN_PACKAGE = `@karmaniverous/${PLUGIN_ID}`;

/** Default watcher API port. */
export const DEFAULT_PORT = DEFAULT_PORTS.watcher;

/** Default watcher API base URL. */
export const DEFAULT_API_URL = `http://127.0.0.1:${String(DEFAULT_PORT)}`;

/** Default platform config root path. */
export const DEFAULT_CONFIG_ROOT = 'j:/config';

/**
 * Timeout in milliseconds for menu generation fetch calls.
 *
 * @remarks
 * Must be generous enough to survive watcher startup (initial scan can
 * take 15+ minutes on large filesystems). If the fetch hangs past this
 * timeout, the `createAsyncContentCache` `refreshing` flag is cleared
 * and the next cycle retries. Too short = unnecessary "unreachable"
 * messages. Too long = `refreshing` deadlock when the server genuinely
 * hangs. 10 seconds balances both concerns.
 */
export const MENU_FETCH_TIMEOUT_MS = 10_000;
