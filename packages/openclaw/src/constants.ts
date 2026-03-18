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
