/**
 * @module api/changeSource
 * Zod schema and type of `GET /status` `health.changeSource` (D133, D157): the change source and reconciliation counters. No I/O.
 */

import { z } from 'zod';

/**
 * Change-source health in `GET /status` `health.changeSource` (D133, D157):
 * counts and timestamps only, never paths (D89).
 */
export const changeSourceHealthSchema = z
  .object({
    /** The running change source. */
    source: z
      .enum(['chokidar', 'parcel'])
      .describe('The running change source.'),
    /** Subscriptions re-created after an error since start (D131). */
    resubscribes: z
      .number()
      .describe(
        'Subscriptions re-created after an error since start (D131); scheduled renewals are not counted. Always 0 under chokidar.',
      ),
    /** Roots currently unavailable (D109). */
    unavailableRoots: z
      .number()
      .describe('Roots currently marked unavailable (D109).'),
    /** Synthetic events reconciliation has emitted since start (D90). */
    reconcileEvents: z
      .number()
      .describe(
        'Synthetic events reconciliation has emitted since start (D90): a rising value means the source is missing events.',
      ),
    /** Reconciles that errored and emitted nothing since start (D90). */
    reconcileErrors: z
      .number()
      .describe(
        'Reconciles that errored (walk failure, unreachable root, empty root walk against a non-empty inventory) and emitted nothing, since start (D90).',
      ),
    /** End of the most recent reconcile. */
    lastReconcileAt: z
      .string()
      .nullable()
      .describe(
        'End of the most recent reconcile (ISO), null before the first.',
      ),
    /** Duration of the most recent reconcile (walk and compare). */
    lastReconcileDurationMs: z
      .number()
      .nullable()
      .describe(
        'Duration of the most recent reconcile, walk and compare (ms), null before the first.',
      ),
    /** Paths in the stability ticker's pending set (D128). */
    pendingStability: z
      .number()
      .describe(
        "Paths in the stability ticker's pending set (D128); a backlog that keeps growing means the ticker is falling behind.",
      ),
    /** Duration of the most recent subscription renewal (D129). */
    lastRenewDurationMs: z
      .number()
      .nullable()
      .describe(
        'Duration of the most recent subscription renewal (ms, D129); null until the first, and always null under chokidar and on Windows.',
      ),
    /** Renewals that forced a source rebuild since start (D165). */
    renewFailures: z
      .number()
      .describe(
        'Renewals whose unsubscribe rejected and forced a source rebuild, plus rejections during a rebuild, since start (D165, D176). Always 0 under chokidar.',
      ),
  })
  .describe('Change-source health (D133, D157).');

/** Change-source health in `GET /status` `health.changeSource`. */
export type ChangeSourceHealth = z.infer<typeof changeSourceHealthSchema>;
