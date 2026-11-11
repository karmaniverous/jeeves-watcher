/**
 * @module api/catalog/renderHandler
 * Catalog handler for POST /render: runs a file (path) or a source document
 * (source) through the rule engine and returns rendered content. The
 * entry's body schema already guarantees exactly one of `path`/`source`.
 * Every success for a source target carries `Cache-Control: no-cache`;
 * errors are thrown `defineError` classes (jeeves sends no other header on
 * an error, Design 2).
 */

import type {
  CatalogHandler,
  ResponseHeaders,
} from '@karmaniverous/jeeves/fastify';
import {
  documentTarget,
  extractWatchPathStrings,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { WatchConfig } from '../../config/types';
import type { WatcherProcessor } from '../../processor';
import { ProcessingFailure } from '../../processor/issueRecording';
import { isPathWatched } from '../../util/isPathWatched';
import { PathNotFound, PathNotWatched, renderFailureError } from '../errors';
import type { Entry } from './catalogEntry';
import { renderSourceDocument } from './renderSourceDocument';
import { toCallerError } from './wrapCatalogHandler';

/** Dependencies for the catalog `render` entry's handler. */
export interface CatalogRenderDeps {
  /** The document processor. */
  processor: WatcherProcessor;
  /** Getter for live watch config. */
  getWatch: () => WatchConfig;
  /** Logger instance. */
  logger: pino.Logger;
}

/** Headers sent with every source-target success. */
const NO_CACHE_HEADERS: ResponseHeaders = { 'Cache-Control': 'no-cache' };

/** Whether an error (or its cause) is a missing-file error. */
function isMissingFile(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true;
    if (e.message.includes('ENOENT') || e.message.includes('no such file')) {
      return true;
    }
  }
  return false;
}

/**
 * Create the catalog handler for `POST /render`.
 *
 * File renders: a path outside the watch scope is
 * `403 WATCHER_PATH_NOT_WATCHED`, a missing file `404 WATCHER_NOT_FOUND`,
 * any other rendering failure `422 WATCHER_PIPELINE_<TYPE>_ERROR` by its
 * issue type (logged with the failure). Failures outside rendering are
 * rethrown: jeeves masks and logs them as a 500.
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogRenderHandler(
  deps: CatalogRenderDeps,
): CatalogHandler<Entry<'render'>> {
  return async (input) => {
    const target = documentTarget(input.body);

    if (target.kind === 'source') {
      try {
        const body = await renderSourceDocument(
          deps.processor,
          target.source,
          deps.logger,
        );
        return { status: 200, body, headers: NO_CACHE_HEADERS };
      } catch (error) {
        throw toCallerError(error, deps.logger, 'Render');
      }
    }

    const filePath = target.path;
    const watch = deps.getWatch();
    if (
      !isPathWatched(
        filePath,
        extractWatchPathStrings(watch.paths),
        watch.ignored,
      )
    ) {
      throw new PathNotWatched();
    }

    try {
      const result = await deps.processor.renderFile(filePath);
      const body = {
        renderAs: result.renderAs,
        content: result.content,
        rules: result.rules,
        metadata: result.metadata,
      };
      // Passthrough responses should not be cached.
      return result.transformed
        ? { status: 200, body }
        : { status: 200, body, headers: NO_CACHE_HEADERS };
    } catch (error) {
      if (isMissingFile(error)) throw new PathNotFound();
      // Everything renderFile runs is the extraction pipeline (stat,
      // extract, rules, template): its failures are the documented 422s,
      // tagged `extraction_error` unless a stage already tagged them.
      const failure =
        error instanceof ProcessingFailure
          ? error
          : new ProcessingFailure('extraction_error', error);
      deps.logger.warn(
        { filePath, err: failure, details: failure.details },
        'Render failed',
      );
      throw renderFailureError(failure.issueType);
    }
  };
}
