/**
 * @module watcher/changeSource/subscriptionContext
 * What every root subscription of one parcel source shares, and how a subscription error is read (its code; a failed `inotify_add_watch`, D156). Types and pure helpers.
 */

import type pino from 'pino';

import type { ParcelBackend, ParcelWatcherModule } from './parcelModule';
import type { ProcessRestarter } from './restart';
import type { ChangeSink } from './types';

/** What every root subscription of one source shares. */
export interface SubscriptionContext {
  parcel: ParcelWatcherModule;
  backend: ParcelBackend;
  sink: ChangeSink;
  logger: pino.Logger;
  /** Resolves when the path exists; rejects with its error otherwise. */
  lstat: (path: string) => Promise<unknown>;
  /** Run work after every earlier source operation (renewals, retries). */
  serial: <T>(work: () => Promise<T>) => Promise<T>;
  /**
   * Set only where parcel never unsubscribes (Windows, D196): stop drops
   * the handle without unsubscribing, and an error on a live subscription
   * (or its root gone) exits the process for a restart instead of
   * unsubscribing and resubscribing. A subscribe that never succeeded has
   * no handle to release, so it still retries with backoff.
   */
  restarter?: ProcessRestarter;
}

/**
 * An error's code (`ENOENT`, ...) or name.
 *
 * @param error - The error.
 * @returns Its code, else its name, else `UnknownError`.
 */
export function codeOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.name : 'UnknownError';
}

/**
 * Whether a parcel error is a failed `inotify_add_watch` (D156).
 *
 * @param error - The error.
 * @returns True for that failure.
 */
export function isWatchLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('inotify_add_watch');
}
