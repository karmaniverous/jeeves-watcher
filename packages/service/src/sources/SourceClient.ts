/**
 * @module sources/SourceClient
 * Registry of configured sources: resolves `<name>://<id>` to a config-built URL and retrieves it with per-source concurrency caps. Network I/O via requestSource.
 */

import type { SourcesConfig } from '@karmaniverous/jeeves-watcher-core';

import { requestSource } from './requestSource';
import { Semaphore } from './semaphore';
import {
  buildSourceUrl,
  parseSourceReference,
  templateOrigin,
} from './sourceUrl';
import {
  type ResolvedSourceReference,
  SourceReferenceError,
  type SourceRetrievalResult,
} from './types';

/**
 * Retrieves source documents by callback. Injected into later pipeline
 * stages (resolver, notify queue, reindex) so tests can substitute it.
 */
export interface SourceRetriever {
  /**
   * Validate a reference and build its URL without making a request.
   *
   * @throws {@link SourceReferenceError}
   */
  resolve(reference: string): ResolvedSourceReference;
  /**
   * Retrieve a document. Rejects with {@link SourceReferenceError} (and
   * sends nothing) for an invalid reference; otherwise never rejects.
   */
  retrieve(reference: string): Promise<SourceRetrievalResult>;
}

interface SourceEntry {
  template: string;
  origin: string;
  headers: Record<string, string>;
  timeoutMs: number;
  semaphore: Semaphore;
}

/**
 * The source callback client. Constructed once from the parsed `sources`
 * config (defaults applied, `${ENV}` already substituted at load). Each
 * source gets its own concurrency semaphore; the `timeoutMs` clock starts
 * when a request leaves the queue, not while it waits for a slot. Callbacks
 * do not draw from the embedding rate limiter.
 */
export class SourceClient implements SourceRetriever {
  private readonly entries = new Map<string, SourceEntry>();

  /**
   * @param sources - The parsed `sources` config section.
   * @throws Error when a `url` template is not an absolute http(s) URL or
   *   places `{id}` in its origin (scheme, host or port).
   */
  constructor(sources: SourcesConfig = {}) {
    for (const [name, config] of Object.entries(sources)) {
      const origin = templateOrigin(config.url);
      if (origin === undefined) {
        throw new Error(
          `sources.${name}.url must be an absolute http(s) URL with {id} outside its origin`,
        );
      }
      this.entries.set(name, {
        template: config.url,
        origin,
        headers: { ...config.headers },
        timeoutMs: config.timeoutMs,
        semaphore: new Semaphore(config.concurrency),
      });
    }
  }

  /** {@inheritDoc SourceRetriever.resolve} */
  resolve(reference: string): ResolvedSourceReference {
    return this.resolveEntry(reference).resolved;
  }

  /** {@inheritDoc SourceRetriever.retrieve} */
  async retrieve(reference: string): Promise<SourceRetrievalResult> {
    const { resolved, entry } = this.resolveEntry(reference);
    return entry.semaphore.run(() =>
      requestSource({
        name: resolved.name,
        url: resolved.url,
        headers: entry.headers,
        timeoutMs: entry.timeoutMs,
      }),
    );
  }

  private resolveEntry(reference: string): {
    resolved: ResolvedSourceReference;
    entry: SourceEntry;
  } {
    const parsed = parseSourceReference(reference);
    const entry = this.entries.get(parsed.name);
    if (!entry) {
      throw new SourceReferenceError(
        'unknown_source',
        `Source "${parsed.name}" is not configured`,
      );
    }
    const url = buildSourceUrl(entry.template, entry.origin, parsed.id);
    return { resolved: { ...parsed, url }, entry };
  }
}
