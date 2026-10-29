/**
 * @module test/wire/wireApp
 * The real `createApiServer` on scriptable stubs (processor, vector store, embedding provider) plus a temp config file and a real git repo, for the slice routes' wire baseline. Writes temp files; no network.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import pino from 'pino';

import { createApiServer } from '../../api';
import type { ApiServerOptions } from '../../api/apiServerOptions';
import type { JeevesWatcherConfig } from '../../config/types';
import { watcherDescriptor } from '../../descriptor';
import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import { ProcessingFailure } from '../../processor/issueRecording';
import { execFileAsync } from '../git';
import { makeVcsApiCoordinator, makeVcsApiRoot } from '../vcsHandlers';

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
  /** What a source render does. */
  sourceRender:
    | 'ok'
    | 'gone'
    | 'source_unavailable'
    | 'unsupported_content_type'
    | 'rule_missing';
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
};

/** A started wire app. */
export interface WireApp {
  /** The Fastify app (VCS enabled). */
  app: FastifyInstance;
  /** The same server without a VCS coordinator. */
  appWithoutVcs: FastifyInstance;
  /** Stub behaviour (mutate per request; reset with {@link WireApp.reset}). */
  state: WireState;
  /** Restore {@link DEFAULT_WIRE_STATE} and the original config file. */
  reset: () => Promise<void>;
  /** VCS root (forward slashes). */
  vcsRoot: string;
  /** Commit holding the VCS fixture files. */
  commit: string;
  /** Temp directory holding the config file. */
  dir: string;
  /** Close both apps and remove temp files. */
  close: () => Promise<void>;
}

/** API key of the wire app. */
export const WIRE_KEY = 'wire-key';

const point = { id: 'p1', score: 0.9, payload: { file_path: 'a.md' } };
const scrolled = { id: 'p1', payload: { file_path: 'a.md' } };

/** Files committed to the VCS root besides `hello.txt`. */
export const VCS_FILES: Record<string, string> = {
  'notes.md': '# Notes\n\nSome *markdown*.\n',
  'data.json': '{ "a": 1 }\n',
  'blob.xyz': 'opaque',
};

function qdrantRejection(): Error {
  return Object.assign(new Error('Bad Request'), {
    status: 400,
    data: { status: { error: 'Wrong filter' } },
  });
}

function sourceOperations(state: WireState) {
  return {
    storedRule: () => Promise.resolve(state.sourceRule),
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

/** Config file contents the apply scenarios start from. */
export const WIRE_CONFIG_FILE = {
  watch: { paths: ['**/*.md'], ignored: [] },
  embedding: { provider: 'mock', model: 'mock', dimensions: 3 },
  vectorStore: { url: 'http://127.0.0.1:9', collectionName: 'wire' },
};

/** Bearer header the wire app accepts. */
export const WIRE_AUTH = { authorization: `Bearer ${WIRE_KEY}` };

/**
 * Start the wire app.
 *
 * @returns The started app; call `close` in `afterAll`.
 */
export async function startWireApp(): Promise<WireApp> {
  const dir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-wire-'));
  const configPath = join(dir, 'config.json');
  const writeConfig = () =>
    writeFile(configPath, JSON.stringify(WIRE_CONFIG_FILE, null, 2), 'utf8');
  await writeConfig();

  const vcsRoot = await makeVcsApiRoot();
  for (const [name, content] of Object.entries(VCS_FILES)) {
    await writeFile(join(vcsRoot, name), content, 'utf8');
  }
  await execFileAsync('git', ['add', '.'], { cwd: vcsRoot });
  await execFileAsync('git', ['commit', '-m', 'fixtures'], { cwd: vcsRoot });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: vcsRoot,
  });

  const state: WireState = { ...DEFAULT_WIRE_STATE };
  const options = {
    descriptor: watcherDescriptor,
    configPath,
    config: buildConfig(dir, state),
    logger: pino({ level: 'silent' }),
    version: '0.0.0-wire',
    queue: { pause: () => undefined, resume: () => undefined },
    processor: {
      renderFile: () => renderFile(state),
      sourceOperations: () => sourceOperations(state),
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
      scrollPage: () =>
        state.filterRejected
          ? Promise.reject(qdrantRejection())
          : Promise.resolve({ points: [scrolled], nextCursor: 'next' }),
      count: () => Promise.resolve(42),
    },
    embeddingProvider: {
      dimensions: 3,
      embed: () =>
        state.embedUnavailable
          ? Promise.reject(
              new EmbeddingUnavailableError('budget exhausted', {
                retryAfterMs: 2500,
              }),
            )
          : Promise.resolve([[0.1, 0.2, 0.3]]),
    },
    issuesManager: { getAll: () => ({}) },
    valuesManager: { getAll: () => ({}), getForRule: () => ({}) },
  } as unknown as ApiServerOptions;

  const coordinator = makeVcsApiCoordinator(vcsRoot);
  const app = createApiServer({ ...options, vcsCoordinator: coordinator });
  const appWithoutVcs = createApiServer(options);
  await app.ready();
  await appWithoutVcs.ready();

  return {
    app,
    appWithoutVcs,
    state,
    reset: async () => {
      Object.assign(state, DEFAULT_WIRE_STATE);
      await writeConfig();
    },
    vcsRoot,
    commit: stdout.trim(),
    dir,
    close: async () => {
      await app.close();
      await appWithoutVcs.close();
      await rm(dir, { recursive: true, force: true });
      await rm(vcsRoot, { recursive: true, force: true });
    },
  };
}
