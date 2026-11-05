/**
 * @module watcher/runningHandlers
 * What a running watcher does when the stability ticker settles a path (D142) or a `.gitignore` changes (D99). Pure apart from the handlers it calls.
 */

import { dirname } from 'node:path';

import type pino from 'pino';

import type { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';
import { rebuildAfterGitignore } from './inventory/rebuildUnder';
import type { Running } from './running';
import { settledEvent, type SettledPath } from './stability/StabilityTicker';

/**
 * A path settled in the stability ticker: emit `add` or `change` through
 * the normal handlers unless the inventory already holds it (D142).
 *
 * @param running - The running watcher.
 * @param settled - The path, its stats and whether reconciliation entered it.
 * @param health - Counts synthetic events.
 */
export function applySettled(
  running: Running,
  { path, stats, synthetic }: SettledPath,
  health?: ChangeSourceHealthTracker,
): void {
  const event = settledEvent(running.inventory.get(path), stats);
  if (!event) return;
  if (event === 'add') running.events.add(path, stats, synthetic);
  else running.events.change(path, stats);
  if (synthetic) health?.recordReconcileEvents(1);
}

/**
 * A `.gitignore` changed: once its root's initial scan is done, rebuild
 * the inventory entries under its directory (D99). During the scan the
 * filter already holds every `.gitignore` (read at construction).
 *
 * @param running - The running watcher.
 * @param path - The `.gitignore`.
 * @param logger - For the rebuild.
 */
export function onGitignoreChanged(
  running: Running,
  path: string,
  logger: pino.Logger,
): void {
  const root = running.roots.rootOf(path);
  if (root === undefined || running.pendingRoots.has(root)) return;
  void rebuildAfterGitignore(running, dirname(path), logger);
}
