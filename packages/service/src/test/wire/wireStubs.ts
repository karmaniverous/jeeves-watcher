/**
 * @module test/wire/wireStubs
 * The wire app's scriptable stubs (processor, vector store, embedding provider, queues, filesystem watcher) and the `createApiServer` options built from them. Pure apart from the stubs' fixed fake I/O.
 */

import { join } from 'node:path';

import type { IssueType } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { ApiServerOptions } from '../../api/apiServerOptions';
import { ReindexTracker } from '../../api/ReindexTracker';
import type { JeevesWatcherConfig } from '../../config/types';
import { watcherDescriptor } from '../../descriptor';
import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import { DocumentLockTimeoutError } from '../../processor/DocumentLocks';
import { ProcessingFailure } from '../../processor/issueRecording';
import type { VirtualRuleStore } from '../../rules/virtualRules';
import { normalizeSlashes } from '../../util/normalizeSlashes';
import { ChangeSourceHealthTracker } from '../../watcher/ChangeSourceHealthTracker';
import { IndexCheckHealthTracker } from '../../watcher/indexCheck/IndexCheckHealthTracker';

/** Scriptable stub behaviour; tests set fields before each request. */
export interface WireState {
  /** `getCollectionInfo` throws (degraded status). */
  degraded: boolean;
  /** Hybrid search configured. */
  hybrid: boolean;
  /** The embedding budget is exhausted (search 503). */
  embedUnavailable: boolean;
  /** Qdrant rejects the filter (400). */
  filterRejected: boolean;
  /** What `renderFile` does. */
  render: 'transformed' | 'passthrough' | 'missing' | 'pipeline' | 'crash';
  /** Stored designated rule of a source document (`null`: not indexed). */
  sourceRule: string | null;
  /** Filesystem watcher state seen by `POST /walk`. */
  walk: 'ready' | 'scanning' | 'absent';
  /** Deletion scrolls also return a source-document point. */
  sourcePoint: boolean;
  /** What a source render does: succeed, answer gone, or fail by issue type. */
  sourceRender: 'ok' | 'gone' | IssueType;
  /** A source metadata update finds its document lock busy (503, D118). */
  documentBusy: boolean;
  /**
   * The query embedding fails with an error the watcher doesn't map (a
   * masked 500): a plain `Error`, a Qdrant `ApiError` outside
   * `withFilterErrors`, or an `Error` carrying `statusCode` and `headers`.
   */
  embedFailure?: 'plain' | 'qdrant' | 'statusHeaders';
}

/** Default stub behaviour. */
export const DEFAULT_WIRE_STATE: WireState = {
  degraded: false,
  hybrid: false,
  embedUnavailable: false,
  filterRejected: false,
  render: 'transformed',
  sourceRule: 'chat',
  sourceRender: 'ok',
  walk: 'ready',
  sourcePoint: false,
  documentBusy: false,
  embedFailure: undefined,
};

/** The query-embedding failure of {@link WireState.embedFailure}. */
function embedFailure(kind: NonNullable<WireState['embedFailure']>): Error {
  if (kind === 'qdrant') return qdrantRejection();
  if (kind === 'statusHeaders')
    return Object.assign(new Error('upstream said no'), {
      statusCode: 503,
      headers: { 'retry-after': '5' },
    });
  return new Error('secret provider detail');
}

/** API key of the wire app. */
export const WIRE_KEY = 'wire-key';

const point = { id: 'p1', score: 0.9, payload: { file_path: 'a.md' } };
const scrolled = { id: 'p1', payload: { file_path: 'a.md' } };
/** A source-document point, as deletion scrolls see it. */
const sourcePointOf = () => ({
  id: 'p2',
  payload: { source: 'app://chat/1', file_path: 'app://chat/1' },
});

function qdrantRejection(): Error {
  return Object.assign(new Error('Bad Request'), {
    status: 400,
    data: { status: { error: 'Wrong filter' } },
  });
}

function sourceOperations(state: WireState) {
  return {
    storedRule: () => Promise.resolve(state.sourceRule),
    validate: () => undefined,
    compiledRule: () => ({ rule: { name: state.sourceRule ?? 'chat' } }),
    updateMetadata: () =>
      state.documentBusy
        ? Promise.reject(
            new DocumentLockTimeoutError('app://chat/1', 'metadata', 10_000),
          )
        : Promise.resolve(state.sourceRule === null ? null : { ok: true }),
    withLock: <T>(_ref: string, _operation: string, work: () => Promise<T>) =>
      work(),
    render: () => {
      if (state.sourceRender === 'ok') {
        return Promise.resolve({
          kind: 'ok',
          result: {
            renderAs: 'md',
            content: '# Chat',
            rules: ['chat'],
            metadata: { channel: 'c1' },
          },
        });
      }
      if (state.sourceRender === 'gone')
        return Promise.resolve({ kind: 'gone' });
      return Promise.resolve({
        kind: 'failed',
        error: {
          code: state.sourceRender,
          message: `${state.sourceRender} happened`,
          details: { reason: 'stub' },
        },
      });
    },
  };
}

function renderFile(state: WireState) {
  switch (state.render) {
    case 'missing':
      return Promise.reject(
        Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
      );
    case 'pipeline':
      return Promise.reject(
        new ProcessingFailure('extraction_error', new Error('bad bytes')),
      );
    case 'crash':
      return Promise.reject(new TypeError('stub crash'));
    default:
      return Promise.resolve({
        renderAs: 'md',
        content: '# Rendered',
        rules: state.render === 'transformed' ? ['doc'] : [],
        metadata: { title: 'Rendered' },
        transformed: state.render === 'transformed',
      });
  }
}

function buildConfig(dir: string, state: WireState): JeevesWatcherConfig {
  return {
    watch: { paths: ['**/*.md'], ignored: [] },
    embedding: { provider: 'mock', model: 'mock', dimensions: 3 },
    vectorStore: { url: 'http://127.0.0.1:9', collectionName: 'wire' },
    stateDir: join(dir, 'state'),
    api: { cacheTtlMs: 0, apiKey: WIRE_KEY },
    inferenceRules: [],
    get search() {
      return state.hybrid ? { hybrid: { enabled: true, textWeight: 0.3 } } : {};
    },
  };
}

/** What {@link wireServerOptions} builds the server options from. */
export interface WireServerContext {
  /** Temp directory holding the config file. */
  dir: string;
  /** Config file path. */
  configPath: string;
  /** Stub behaviour (mutated per request). */
  state: WireState;
  /** Logger for the server. */
  logger: pino.Logger;
  /** The virtual rule store (cleared between scenarios). */
  rules: VirtualRuleStore;
}

/**
 * The `createApiServer` options of the wire app: every dependency is a stub
 * driven by `state` (no VCS coordinator; the caller adds one).
 *
 * @param context - Temp paths, stub state, logger and rule store.
 * @returns The server options.
 */
export function wireServerOptions(
  context: WireServerContext,
): ApiServerOptions {
  const { dir, configPath, state, logger, rules } = context;
  return {
    descriptor: watcherDescriptor,
    configPath,
    config: buildConfig(dir, state),
    logger,
    version: '0.0.0-wire',
    queue: {
      pause: () => undefined,
      resume: () => undefined,
      waitForIdleWorkers: () => Promise.resolve(),
    },
    processor: {
      renderFile: () => renderFile(state),
      sourceOperations: () => sourceOperations(state),
      processMetadataUpdate: () => Promise.resolve(),
      processRulesUpdate: () => Promise.resolve({ ok: true }),
    },
    vectorStore: {
      getCollectionInfo: () =>
        state.degraded
          ? Promise.reject(new Error('qdrant down'))
          : Promise.resolve({
              pointCount: 7,
              dimensions: 3,
              payloadFields: {},
            }),
      search: () =>
        state.filterRejected
          ? Promise.reject(qdrantRejection())
          : Promise.resolve([point]),
      hybridSearch: () => Promise.resolve([{ ...point, score: 0.5 }]),
      // The first page offers a cursor; following it ends the scroll, so
      // paging callers (deletion, rule re-apply) terminate.
      scrollPage: (_filter: unknown, _limit: number, cursor?: string) =>
        state.filterRejected
          ? Promise.reject(qdrantRejection())
          : Promise.resolve(
              cursor === 'next'
                ? { points: [], nextCursor: undefined }
                : {
                    points: state.sourcePoint
                      ? [scrolled, sourcePointOf()]
                      : [scrolled],
                    nextCursor: 'next',
                  },
            ),
      delete: () => Promise.resolve(),
      scroll: async function* () {
        yield { id: 'p1', payload: { file_path: 'a.md', chunk_index: 0 } };
        await Promise.resolve();
      },
      // rebuild-metadata re-reads chunk 0 under the document lock.
      getPayload: () =>
        Promise.resolve({ file_path: 'a.md', chunk_index: 0, title: 'A' }),
      count: () => Promise.resolve(42),
    },
    embeddingProvider: {
      dimensions: 3,
      embed: () =>
        state.embedFailure
          ? Promise.reject(embedFailure(state.embedFailure))
          : state.embedUnavailable
            ? Promise.reject(
                new EmbeddingUnavailableError('budget exhausted', {
                  retryAfterMs: 2500,
                }),
              )
            : Promise.resolve([[0.1, 0.2, 0.3]]),
    },
    issuesManager: { getAll: () => ({}), clear: () => undefined },
    enrichmentStore: { set: () => undefined, delete: () => undefined },
    virtualRuleStore: rules,
    reindexTracker: new ReindexTracker(),
    changeSourceHealth: new ChangeSourceHealthTracker(),
    indexCheckHealth: new IndexCheckHealthTracker(),
    sourceQueue: {
      enqueue: () => true,
      processNow: (source: string) =>
        Promise.resolve({ source, status: 'indexed' }),
    },
    getFileSystemWatcher: () =>
      state.walk === 'absent'
        ? undefined
        : {
            isReady: state.walk === 'ready',
            getWatchedFiles: () => [
              normalizeSlashes(join(dir, 'docs', 'a.md')),
              normalizeSlashes(join(dir, 'docs', 'b.txt')),
            ],
          },
    valuesManager: { getAll: () => ({}), getForRule: () => ({}) },
  } as unknown as ApiServerOptions;
}
