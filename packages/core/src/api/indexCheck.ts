/**
 * @module api/indexCheck
 * Zod schema and type of `GET /status` `health.indexCheck` (D197): the state and counts of the index check that runs once after the start walk. No I/O.
 */

import { z } from 'zod';

/**
 * State of the index check at start (D197): `pending` until the start walk
 * completes, `running`, then `done` or `failed` (the index could not be
 * listed, or the watcher stopped or was rebuilt first; nothing more is
 * deleted); `off` when `watch.indexCheckOnStart` is `false`.
 */
export const indexCheckStateSchema = z
  .enum(['pending', 'running', 'done', 'failed', 'off'])
  .describe(
    'Index check state: pending (the start walk is still running), running, done, failed (the index could not be listed, or the watcher stopped or was rebuilt first; nothing more is deleted) or off (watch.indexCheckOnStart is false).',
  );

/** State of the index check at start. */
export type IndexCheckState = z.infer<typeof indexCheckStateSchema>;

/**
 * Index-check health in `GET /status` `health.indexCheck` (D197): counts
 * and timestamps only, never paths (D89).
 */
export const indexCheckHealthSchema = z
  .object({
    /** Where the check is. */
    state: indexCheckStateSchema,
    /** When it ended. */
    at: z
      .string()
      .nullable()
      .describe('When the check ended (ISO), null until it is done or failed.'),
    /** How long it took. */
    durationMs: z
      .number()
      .nullable()
      .describe(
        'How long the check took, listing and deletes (ms), null until it is done or failed.',
      ),
    /** File documents compared with the inventory. */
    checked: z
      .number()
      .describe(
        'Indexed file documents compared with the inventory, under the roots that were checked.',
      ),
    /** Documents deleted. */
    removed: z
      .number()
      .describe(
        'Indexed file documents deleted because their file is gone (deleted or moved away while the service was down).',
      ),
    /** Roots not checked. */
    skippedRoots: z
      .number()
      .describe(
        'Watch roots not checked: unavailable, gone, unwatched, or whose start walk failed.',
      ),
    /** Roots over the cap. */
    capped: z
      .number()
      .describe(
        'Watch roots where more than 10% of the indexed documents, or more than 1,000, were missing from the inventory: nothing was deleted there; run reindex prune deliberately.',
      ),
  })
  .describe('Index check at start (D197).');

/** Index-check health in `GET /status` `health.indexCheck`. */
export type IndexCheckHealth = z.infer<typeof indexCheckHealthSchema>;
