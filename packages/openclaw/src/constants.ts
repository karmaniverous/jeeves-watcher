/**
 * @module plugin/constants
 * Shared constants for the OpenClaw plugin package.
 *
 * @remarks
 * Imported by both the plugin bundle (`index.ts`) and the CLI bundle
 * (`cli.ts`). Rollup inlines these into each output independently.
 */

/** Plugin identifier used in OpenClaw config and extensions directory. */
export const PLUGIN_ID = 'jeeves-watcher-openclaw';

/** Default watcher API base URL. */
export const DEFAULT_API_URL = 'http://127.0.0.1:1936';

/** Default platform config root path. */
export const DEFAULT_CONFIG_ROOT = 'j:/config';

/** Default Qdrant health check URL (used in diagnostic output). */
export const DEFAULT_QDRANT_URL = 'http://127.0.0.1:6333';

/** Timeout in milliseconds for service health probes. */
export const PROBE_TIMEOUT_MS = 1500;

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
