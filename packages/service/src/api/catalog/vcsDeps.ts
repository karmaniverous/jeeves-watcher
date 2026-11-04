/**
 * @module api/catalog/vcsDeps
 * Dependencies shared by the version-control (`/vcs/*`) catalog handlers. They are built only while VCS is on, so the coordinator is never optional: with VCS off, the feature gate (`api/featureGates`) answers every `/vcs/*` request first. Types only.
 */

import type pino from 'pino';

import type { VcsCoordinator } from '../../vcs/VcsCoordinator';

/** Dependencies for a `/vcs/*` entry's catalog handler. */
export interface CatalogVcsDeps {
  /** VCS coordinator (tracked roots and git operations). */
  coordinator: VcsCoordinator;
  /** Logger. */
  logger: pino.Logger;
}
