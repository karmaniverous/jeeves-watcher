/**
 * @module api/queueDeps
 * Queue dependencies of the API server: the pausable queue set quiesced by prune, and the source notify queue for `POST /documents`. Types only.
 */

import type { PausableQueue } from '../queue';
import type { SourceNotifyQueue } from '../queue/SourceNotifyQueue';

/** Queue dependencies of the API server (`createApiServer`). */
export interface ApiQueueDeps {
  /** Queues paused during prune (file event queue, plus the source notify queue). */
  queue: PausableQueue;
  /** Source notify queue (`POST /documents`); absent in file-only setups. */
  sourceQueue?: SourceNotifyQueue;
}
