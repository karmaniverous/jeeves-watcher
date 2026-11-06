/**
 * @module vectorStore/scrollRetry
 * One scroll page with retry and resume: on a failed page, retries from the same cursor with exponential backoff (5 attempts), then rethrows. Shared by `reindex prune` and the index check at start (D197). Qdrant I/O through `VectorStore.scrollPage`.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import type { ScrollPageResult, VectorStore } from './types';

/** Max attempts per page. */
export const SCROLL_RETRY_ATTEMPTS = 5;

/** Base delay of the retry backoff (ms). */
const SCROLL_RETRY_BASE_DELAY_MS = 1000;

/** One page request. */
export interface ScrollPageRequest {
  /** Qdrant filter, if any. */
  filter?: Record<string, unknown>;
  /** Page size. */
  limit: number;
  /** Cursor from the previous page. */
  cursor?: string | number;
  /** Payload fields to return. */
  fields: string[];
  /** What is scrolling, for the retry log line (e.g. `Prune`). */
  label: string;
}

/**
 * Scroll one page, retrying from the same cursor on failure.
 *
 * @param vectorStore - The store to scroll.
 * @param request - Filter, page size, cursor, projection and log label.
 * @param logger - Retry warnings.
 * @param sleep - Waits between attempts (tests).
 * @returns The page.
 * @throws The last error after {@link SCROLL_RETRY_ATTEMPTS} failures.
 */
export async function scrollPageWithRetry(
  vectorStore: Pick<VectorStore, 'scrollPage'>,
  request: ScrollPageRequest,
  logger: pino.Logger,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ScrollPageResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SCROLL_RETRY_ATTEMPTS; attempt++) {
    try {
      return await vectorStore.scrollPage(
        request.filter,
        request.limit,
        request.cursor,
        request.fields,
      );
    } catch (error) {
      lastError = error;
      if (attempt < SCROLL_RETRY_ATTEMPTS) {
        const delay =
          SCROLL_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) +
          Math.random() * 500;
        logger.warn(
          { attempt, err: normalizeError(error) },
          `${request.label} scroll page failed; retrying in ${String(Math.round(delay))}ms`,
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}
