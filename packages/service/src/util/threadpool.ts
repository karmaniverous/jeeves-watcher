/**
 * @module util/threadpool
 * The libuv threadpool size the service runs with (D170). Pure: edits the given environment object.
 */

/** `UV_THREADPOOL_SIZE` the service uses unless the environment sets one. */
export const SERVICE_THREADPOOL_SIZE = '16';

/**
 * Default `UV_THREADPOOL_SIZE` to 16, keeping a value already set. libuv
 * reads it when the threadpool first starts, so this must run before any
 * threadpool work: the CLI entry imports it first.
 *
 * @param env - The environment to edit (`process.env` in the entry).
 */
export function ensureThreadpoolSize(env: NodeJS.ProcessEnv): void {
  env.UV_THREADPOOL_SIZE ??= SERVICE_THREADPOOL_SIZE;
}
