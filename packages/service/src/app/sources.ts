/**
 * @module app/sources
 * Startup wiring for source documents: builds the source callback client from `sources` config (read at startup only), the notify queue over the processor's source operations, and the adapter giving a file-only processor failing source operations. No I/O.
 */

import type pino from 'pino';

import { RequestError } from '../api/requestError';
import { NOT_AVAILABLE, SOURCES_NOT_SUPPORTED } from '../api/sendError';
import type { JeevesWatcherConfig } from '../config/types';
import type {
  SourceOperationsInterface,
  SourceOperationsProvider,
} from '../processor/SourceOperations';
import type {
  DocumentProcessorInterface,
  WatcherProcessor,
} from '../processor/types';
import {
  SourceNotifyQueue,
  type SourceQueueIssues,
} from '../queue/SourceNotifyQueue';
import { SourceClient, type SourceRetriever } from '../sources';

/**
 * Create the source callback client, once, from the startup config.
 * `sources` changes take effect on restart (as for `api.apiKey`).
 *
 * @param config - The startup configuration.
 * @returns A {@link SourceClient}, or `undefined` when no sources are configured.
 */
export function createSourceRetriever(
  config: JeevesWatcherConfig,
): SourceRetriever | undefined {
  const { sources } = config;
  if (!sources || Object.keys(sources).length === 0) return undefined;
  return new SourceClient(sources);
}

/**
 * The error an API source route answers with on a processor without source
 * support (`503 not_available`).
 *
 * @returns The error (to throw or reject with).
 */
function sourcesNotSupported(): RequestError {
  return new RequestError('not_available', NOT_AVAILABLE, {
    message: SOURCES_NOT_SUPPORTED,
  });
}

/** Source operations of a processor without source support. */
const unsupportedSourceOperations: SourceOperationsInterface = {
  process: (ref) =>
    Promise.resolve({
      source: ref,
      status: 'failed',
      error: {
        code: 'source_unavailable',
        message: 'The document processor does not support source documents',
      },
    }),
  validate: () => {
    throw sourcesNotSupported();
  },
  storedRule: () => Promise.reject(sourcesNotSupported()),
  compiledRule: () => {
    throw sourcesNotSupported();
  },
  render: () => Promise.reject(sourcesNotSupported()),
  updateMetadata: () => Promise.reject(sourcesNotSupported()),
};

/**
 * Adapt a custom file-only processor to the {@link WatcherProcessor} the
 * service runs on. File operations are forwarded unchanged. Its source
 * operations fail: every notify-queue run returns a `failed` result with
 * `source_unavailable` (the run's issue, as for a failing callback), and
 * every other source operation throws the API's `503 not_available`, so
 * `POST /documents`, `POST /metadata { source }`, `POST /render { source }`
 * and `POST /reindex { source }` answer as before source support existed.
 * Use it in a custom `createDocumentProcessor` factory; never wrap a
 * processor that has source operations of its own (they would be hidden).
 *
 * @param processor - The file-only processor.
 * @returns The processor with failing source operations.
 */
export function withoutSourceSupport(
  processor: DocumentProcessorInterface,
): WatcherProcessor {
  return {
    processFile: (filePath) => processor.processFile(filePath),
    deleteFile: (filePath) => processor.deleteFile(filePath),
    processMetadataUpdate: (filePath, metadata) =>
      processor.processMetadataUpdate(filePath, metadata),
    processRulesUpdate: (filePath) => processor.processRulesUpdate(filePath),
    renderFile: (filePath) => processor.renderFile(filePath),
    moveFile: (oldPath, newPath) => processor.moveFile(oldPath, newPath),
    updateRules: (compiledRules, templateEngine, customMapLib) => {
      processor.updateRules(compiledRules, templateEngine, customMapLib);
    },
    sourceOperations: () => unsupportedSourceOperations,
  };
}

/**
 * Create the source notify queue (always, so the API can depend on it; it
 * is idle when nothing is notified). The caller passes the resolved
 * `embedding.concurrency`, shared with the file event queue. The queue is
 * not started: call `start()` alongside the filesystem watcher. Each run
 * uses the processor's source operations as of that run (current rules).
 *
 * @param processor - The processor's source operations provider.
 * @param concurrency - Runs in flight at once (resolved embedding concurrency).
 * @param logger - Logger for unexpected run failures.
 * @param issues - Issues store for unexpected run failures.
 * @returns The (unstarted) queue.
 */
export function createNotifyQueue(
  processor: SourceOperationsProvider,
  concurrency: number,
  logger: pino.Logger,
  issues?: SourceQueueIssues,
): SourceNotifyQueue {
  return new SourceNotifyQueue(
    {
      process: (ref, rule, options) =>
        processor.sourceOperations().process(ref, rule, options),
    },
    { concurrency },
    logger,
    issues,
  );
}
