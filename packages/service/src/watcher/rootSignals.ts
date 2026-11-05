/**
 * @module watcher/rootSignals
 * What `FileSystemWatcher` does when its source reports a root's subscription state: resubscribed (D131), unavailable (D109) or reachable but unwatched (D156), available again. Pure apart from logging and reconcile triggers.
 */

import type pino from 'pino';

import type { RootUnavailableOptions } from './changeSource/types';
import type { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';
import type { Running } from './running';

/** One root signal: the running state, the canonical root and its effects. */
export interface RootSignal {
  running: Running;
  root: string;
  logger: pino.Logger;
  health?: ChangeSourceHealthTracker;
  /** Start a reconcile (owned by `FileSystemWatcher`, D120). */
  reconcile: (dir: string) => void;
}

/**
 * The source re-created the root's subscription after an error (D131):
 * events in between are lost, so reconcile the root (once its initial scan
 * finishes, if it has not).
 *
 * @param signal - The root and its effects.
 */
export function onResubscribed(signal: RootSignal): void {
  const { running, root } = signal;
  signal.logger.info({ root }, 'Change source resubscribed');
  signal.health?.recordResubscribe();
  if (running.pendingRoots.has(root)) running.deferredRoots.add(root);
  else signal.reconcile(root);
}

/**
 * The root is unreachable (D109): mark it (nothing is unlinked; its
 * reconciles are skipped) and drop its pending stability waits. A root
 * that is reachable but unwatched (D156) only counts as unavailable: it is
 * still reconciled.
 *
 * @param signal - The root and its effects.
 * @param code - The error code.
 * @param options - Whether the root is still reachable.
 */
export function onRootUnavailable(
  signal: RootSignal,
  code: string,
  options?: RootUnavailableOptions,
): void {
  const { running, root } = signal;
  signal.logger.warn({ root, code, ...options }, 'Watch root unavailable');
  signal.health?.setUnavailable(root, true);
  if (options?.reachable) {
    running.unwatchedRoots.add(root);
    return;
  }
  running.unavailableRoots.add(root);
  running.ticker.dropUnder(root);
}

/**
 * The root is reachable again (D109): unmark and reconcile it.
 *
 * @param signal - The root and its effects.
 */
export function onRootAvailable(signal: RootSignal): void {
  const { running, root } = signal;
  signal.logger.info({ root }, 'Watch root available again');
  running.unavailableRoots.delete(root);
  running.unwatchedRoots.delete(root);
  signal.health?.setUnavailable(root, false);
  signal.reconcile(root);
}
