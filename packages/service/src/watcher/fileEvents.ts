/**
 * @module watcher/fileEvents
 * What a filtered file event does: the VCS hook, move correlation and the processing queue. I/O: enqueues processor work.
 */

import type pino from 'pino';

import type { ContentHashCache } from '../cache';
import type { WatchConfig } from '../config/types';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { MoveCorrelator } from './MoveCorrelator';

/** VCS change callback. */
export type VcsFileChange = (
  filePath: string,
  event: 'add' | 'change' | 'unlink',
) => void;

/** Dependencies of {@link FileEventActions}. */
export interface FileEventActionsDeps {
  queue: EventQueue;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  /** Runs processor work with health tracking. */
  wrap: (fn: () => Promise<void>) => Promise<void>;
  onVcsFileChange?: VcsFileChange;
  /** Move correlator, when move detection is on. */
  correlator?: MoveCorrelator;
}

/**
 * Build the move correlator when move detection is enabled and a content
 * hash cache is available.
 *
 * @param config - Watch config.
 * @param deps - Queue wiring (without a correlator).
 * @param contentHashCache - Content hash cache.
 * @returns The correlator, or undefined.
 */
export function createMoveCorrelator(
  config: WatchConfig,
  deps: Omit<FileEventActionsDeps, 'correlator' | 'onVcsFileChange'>,
  contentHashCache?: ContentHashCache,
): MoveCorrelator | undefined {
  const moveConfig = config.moveDetection;
  if (!moveConfig?.enabled || !contentHashCache) return undefined;
  const { queue, processor, wrap } = deps;
  return new MoveCorrelator({
    enabled: true,
    bufferMs: moveConfig.bufferMs,
    contentHashCache,
    logger: deps.logger,
    onMove: (oldPath, newPath) => {
      enqueueMove(deps, oldPath, newPath);
    },
    onDelete: (deletedPath) => {
      queue.enqueue(
        { type: 'delete', path: deletedPath, priority: 'normal' },
        () => wrap(() => processor.deleteFile(deletedPath)),
      );
    },
    onCreate: (createdPath) => {
      queue.enqueue(
        { type: 'create', path: createdPath, priority: 'normal' },
        () => wrap(() => processor.processFile(createdPath)),
      );
    },
  });
}

/** Enqueue a move: the points are re-keyed, not re-embedded. */
function enqueueMove(
  {
    queue,
    processor,
    wrap,
  }: Pick<FileEventActionsDeps, 'queue' | 'processor' | 'wrap'>,
  oldPath: string,
  newPath: string,
): void {
  queue.enqueue(
    { type: 'move', path: newPath, oldPath, priority: 'normal' },
    () => wrap(() => processor.moveFile(oldPath, newPath)),
  );
}

/** The actions behind filtered `add`, `change` and `unlink` events. */
export class FileEventActions {
  /** @param deps - Queue, processor, hooks and correlator. */
  constructor(private readonly deps: FileEventActionsDeps) {}

  /**
   * A matched file appeared.
   *
   * @param path - The file.
   * @param correlate - Offer it to the move correlator (after the initial scan).
   */
  added(path: string, correlate: boolean): void {
    const { queue, processor, wrap, correlator } = this.deps;
    this.deps.logger.debug({ path }, 'File added');
    this.deps.onVcsFileChange?.(path, 'add');
    if (correlator && correlate) {
      void correlator.handleAdd(path);
    } else {
      queue.enqueue({ type: 'create', path, priority: 'normal' }, () =>
        wrap(() => processor.processFile(path)),
      );
    }
  }

  /** A matched file changed. */
  changed(path: string): void {
    const { queue, processor, wrap } = this.deps;
    this.deps.logger.debug({ path }, 'File changed');
    this.deps.onVcsFileChange?.(path, 'change');
    queue.enqueue({ type: 'modify', path, priority: 'normal' }, () =>
      wrap(() => processor.processFile(path)),
    );
  }

  /** A matched file went away. */
  removed(path: string): void {
    const { queue, processor, wrap, correlator } = this.deps;
    this.deps.logger.debug({ path }, 'File removed');
    this.deps.onVcsFileChange?.(path, 'unlink');
    if (correlator) {
      correlator.handleUnlink(path);
    } else {
      queue.enqueue({ type: 'delete', path, priority: 'normal' }, () =>
        wrap(() => processor.deleteFile(path)),
      );
    }
  }

  /**
   * A matched file moved as part of a paired directory move (D62): the
   * VCS hook sees the unlink and the add; the queue gets one move, which
   * re-keys the points without re-embedding.
   *
   * @param oldPath - Where it was.
   * @param newPath - Where it is.
   */
  moved(oldPath: string, newPath: string): void {
    this.deps.logger.debug({ oldPath, newPath }, 'File moved');
    this.deps.onVcsFileChange?.(oldPath, 'unlink');
    this.deps.onVcsFileChange?.(newPath, 'add');
    enqueueMove(this.deps, oldPath, newPath);
  }

  /** Flush buffered unlinks as deletes (on stop). */
  flush(): void {
    this.deps.correlator?.flush();
  }
}
