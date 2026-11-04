/**
 * @module httpContract
 * The HTTP client constant the CLI and the plugin share: the environment variable holding the watcher API bearer key. Request building and error mapping live in jeeves's catalog client and the SDK's `WatcherError` (spec #281 D36, D53). Pure.
 */

/** Environment variable holding the watcher API bearer key for clients (CLI, plugin). */
export const API_KEY_ENV_VAR = 'JEEVES_WATCHER_API_KEY';
