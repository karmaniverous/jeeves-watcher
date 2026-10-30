/**
 * @module api/catalog/renderHandler
 * Catalog handler for POST /render: runs a file (path) or a source document
 * (source) through the rule engine and returns rendered content. The
 * entry's body schema already guarantees exactly one of `path`/`source`.
 * Every reply for a source target carries `Cache-Control: no-cache`
 * (success and error alike).
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
import type { Entry } from './catalogEntry';
import { errorResult } from './errorResult';
import { renderSourceDocument } from './renderSourceDocument';
import { catalogErrorFromThrown } from './wrapCatalogHandler';

/** Dependencies for the catalog `render` entry's handler. */
export interface CatalogRenderDeps {
  /** The document processor. */
  processor: WatcherProcessor;
  /** Getter for live watch config. */
  getWatch: () => WatchConfig;
  /** Logger instance. */
  logger: pino.Logger;
}

/** Headers sent with every source-target reply (success or error). */
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
 * File renders: a path outside the watch scope is `403 path_not_watched`, a
 * missing file `404 not_found`, any other rendering failure
 * `422 pipeline_error` whose `issueType` names the failed stage. Failures
 * outside rendering are logged and answered with a generic
 * `500 internal_error`.
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
        const body = await renderSourceDocument(deps.processor, target.source);
        return { status: 200, body, headers: NO_CACHE_HEADERS };
      } catch (error) {
        return {
          ...catalogErrorFromThrown(error, deps.logger, 'Render'),
          headers: NO_CACHE_HEADERS,
        };
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
      return errorResult('path_not_watched', 'Path is outside watched scope');
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
      if (isMissingFile(error)) {
        return errorResult('not_found', 'File not found');
      }
      // Everything renderFile runs is the extraction pipeline (stat,
      // extract, rules, template): its failures are the documented
      // `422 pipeline_error`, tagged `extraction_error` unless a stage
      // already tagged them.
      const failure =
        error instanceof ProcessingFailure
          ? error
          : new ProcessingFailure('extraction_error', error);
      deps.logger.warn({ filePath, err: failure }, 'Render failed');
      return errorResult('pipeline_error', failure.message, {
        details: failure.details,
        issueType: failure.issueType,
      });
    }
  };
}
