/**
 * @module api/vcsHealthSource
 * The `health.vcs` source of `GET /status`: present only when some root has VCS enabled (Design 6 Health). Roots are fixed when the coordinator is built, so enabling VCS needs a restart. No I/O.
 */

import type { VcsHealth } from '@karmaniverous/jeeves-watcher-core';

/** What the status source needs from the VCS coordinator. */
export interface VcsHealthProvider {
  /** VCS-enabled roots. */
  getRoots(): readonly string[];
  /** Aggregate VCS health. */
  getHealth(): VcsHealth;
}

/**
 * The `getVcsHealth` dependency of the status source, or nothing when there
 * is no coordinator or no VCS-enabled root (`health.vcs` is then absent).
 *
 * @param coordinator - The VCS coordinator, if any.
 * @returns `{ getVcsHealth }` or `{}`.
 */
export function vcsHealthSource(coordinator?: VcsHealthProvider): {
  getVcsHealth?: () => VcsHealth;
} {
  if (coordinator === undefined || coordinator.getRoots().length === 0) {
    return {};
  }
  return { getVcsHealth: () => coordinator.getHealth() };
}
