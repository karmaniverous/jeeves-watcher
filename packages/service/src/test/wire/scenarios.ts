/**
 * @module test/wire/scenarios
 * Wire scenarios for the catalog slice routes (status, config, config apply, render, search, scan, vcs/show) and a recorder that captures status, the headers clients see and the body, normalising volatile values. Drives a {@link WireApp}; no assertions.
 */

import type { LightMyRequestResponse } from 'fastify';

import { WIRE_AUTH, type WireApp, type WireState } from './wireApp';

/** What a client sees for one request. */
export interface WireRecord {
  /** HTTP status. */
  status: number;
  /** `content-type` header. */
  contentType?: string;
  /** `cache-control` header. */
  cacheControl?: string;
  /** `retry-after` header. */
  retryAfter?: string;
  /** Parsed JSON body, or the raw text for non-JSON replies. */
  body: unknown;
}

/** One request against the wire app. */
export interface WireScenario {
  /** Unique scenario name (fixture key). */
  name: string;
  /** Stub behaviour for this request. */
  state?: Partial<WireState>;
  /** Use the server without a VCS coordinator. */
  withoutVcs?: boolean;
  /** HTTP method. */
  method: 'GET' | 'HEAD' | 'POST';
  /** URL; `{root}` and `{commit}` are filled from the wire app. */
  url: string;
  /** JSON body. */
  payload?: unknown;
}

const post = (
  name: string,
  url: string,
  payload: unknown,
  state?: Partial<WireState>,
): WireScenario => ({ name, method: 'POST', url, payload, state });

const get = (
  name: string,
  url: string,
  extra: Partial<WireScenario> = {},
): WireScenario => ({ name, method: 'GET', url, ...extra });

const show = (file: string) => `/vcs/show?path={root}/${file}&commit={commit}`;

/** Every slice scenario, in run order. */
export const WIRE_SCENARIOS: readonly WireScenario[] = [
  get('status', '/status'),
  { name: 'status HEAD', method: 'HEAD', url: '/status' },
  get('status degraded', '/status', { state: { degraded: true } }),
  get('config full', '/config'),
  get('config jsonpath', '/config?path=$.watch.paths'),
  get('config invalid jsonpath', '/config?path=$[(('),
  post('configApply patch', '/config/apply', { patch: { maxDepth: 4 } }),
  post('configApply config alias', '/config/apply', {
    config: { maxDepth: 5 },
  }),
  post('configApply empty body', '/config/apply', {}),
  post('configApply replace', '/config/apply', {
    patch: {
      watch: { paths: ['**/*.txt'], ignored: [] },
      embedding: { provider: 'mock', model: 'mock', dimensions: 3 },
      vectorStore: { url: 'http://127.0.0.1:9', collectionName: 'wire' },
    },
    replace: true,
  }),
  post('configApply non-object patch', '/config/apply', { patch: [] }),
  post('configApply invalid config', '/config/apply', {
    patch: { watch: 5 },
  }),
  post('render file', '/render', { path: 'docs/a.md' }),
  post(
    'render passthrough',
    '/render',
    { path: 'docs/a.md' },
    { render: 'passthrough' },
  ),
  post('render not watched', '/render', { path: 'docs/a.txt' }),
  post(
    'render missing',
    '/render',
    { path: 'docs/a.md' },
    { render: 'missing' },
  ),
  post(
    'render pipeline error',
    '/render',
    { path: 'docs/a.md' },
    { render: 'pipeline' },
  ),
  post('render crash', '/render', { path: 'docs/a.md' }, { render: 'crash' }),
  post('render neither target', '/render', {}),
  post('render both targets', '/render', {
    path: 'docs/a.md',
    source: 'app://chat/1',
  }),
  post('render source', '/render', { source: 'app://chat/1' }),
  post(
    'render source not indexed',
    '/render',
    { source: 'app://chat/1' },
    { sourceRule: null },
  ),
  post(
    'render source gone',
    '/render',
    { source: 'app://chat/1' },
    { sourceRender: 'gone' },
  ),
  post(
    'render source unavailable',
    '/render',
    { source: 'app://chat/1' },
    { sourceRender: 'source_unavailable' },
  ),
  post(
    'render source unsupported content type',
    '/render',
    { source: 'app://chat/1' },
    { sourceRender: 'unsupported_content_type' },
  ),
  post(
    'render source pipeline error',
    '/render',
    { source: 'app://chat/1' },
    { sourceRender: 'rule_missing' },
  ),
  post('search', '/search', { query: 'hello', limit: 3 }),
  post('search hybrid', '/search', { query: 'hello' }, { hybrid: true }),
  post('search unknown key', '/search', { query: 'hello', collapse: true }),
  post('search empty query', '/search', { query: '' }),
  post(
    'search embedding unavailable',
    '/search',
    { query: 'hello' },
    { embedUnavailable: true },
  ),
  post(
    'search filter rejected',
    '/search',
    { query: 'hello', filter: { must: [{ key: 'x', match: { value: 1 } }] } },
    { filterRejected: true },
  ),
  post('scan', '/scan', {
    filter: { must: [{ key: 'x', match: { value: 1 } }] },
    limit: 5,
  }),
  post('scan countOnly', '/scan', {
    filter: { must: [{ key: 'x', match: { value: 1 } }] },
    countOnly: true,
  }),
  post('scan missing filter', '/scan', {}),
  post('scan limit out of range', '/scan', {
    filter: { must: [{ key: 'x', match: { value: 1 } }] },
    limit: 5000,
  }),
  post(
    'scan filter rejected',
    '/scan',
    { filter: { must: [{ key: 'x', match: { value: 1 } }] } },
    { filterRejected: true },
  ),
  get('vcsShow markdown', show('notes.md')),
  get('vcsShow json', show('data.json')),
  get('vcsShow text', show('hello.txt')),
  get('vcsShow unknown extension', show('blob.xyz')),
  get('vcsShow missing params', '/vcs/show'),
  get('vcsShow missing commit', '/vcs/show?path={root}/notes.md'),
  get('vcsShow unknown root', '/vcs/show?path=/elsewhere/a.md&commit={commit}'),
  get('vcsShow bad commit', '/vcs/show?path={root}/notes.md&commit=deadbeef'),
  get('vcsShow missing file', show('nope.md')),
  get('vcsShow without vcs', show('notes.md'), { withoutVcs: true }),
  get('vcsShow without vcs, missing params', '/vcs/show', {
    withoutVcs: true,
  }),
];

/**
 * Replace volatile values: status uptime, the temp root and commit hash.
 *
 * @param text - Serialised body.
 * @param wire - The wire app.
 * @returns The normalised text.
 */
function normalise(text: string, wire: WireApp): string {
  return text
    .split(wire.vcsRoot)
    .join('{root}')
    .split(wire.commit)
    .join('{commit}')
    .replace(/"uptime":\d+/g, '"uptime":0');
}

/**
 * Record what a client sees.
 *
 * @param res - Injected response.
 * @param wire - The wire app.
 * @param raw - Keep the body as text even when it is JSON (file bytes).
 * @returns The record.
 */
function record(
  res: LightMyRequestResponse,
  wire: WireApp,
  raw: boolean,
): WireRecord {
  const header = (name: string) => {
    const value = res.headers[name];
    return value === undefined ? undefined : String(value);
  };
  const contentType = header('content-type');
  const text = normalise(res.body, wire);
  const isJson =
    !raw && contentType?.startsWith('application/json') && text !== '';
  return {
    status: res.statusCode,
    ...(contentType ? { contentType } : {}),
    ...(header('cache-control')
      ? { cacheControl: header('cache-control') }
      : {}),
    ...(header('retry-after') ? { retryAfter: header('retry-after') } : {}),
    body: isJson ? (JSON.parse(text) as unknown) : text,
  };
}

/**
 * Run one scenario (authenticated) and record the reply.
 *
 * @param wire - The wire app.
 * @param scenario - The scenario.
 * @returns The record.
 */
export async function runScenario(
  wire: WireApp,
  scenario: WireScenario,
): Promise<WireRecord> {
  await wire.reset();
  Object.assign(wire.state, scenario.state);
  const url = scenario.url
    .replace('{root}', wire.vcsRoot)
    .replace('{commit}', wire.commit);
  const app = scenario.withoutVcs ? wire.appWithoutVcs : wire.app;
  const res = await app.inject({
    method: scenario.method,
    url,
    headers: WIRE_AUTH,
    ...(scenario.payload === undefined
      ? {}
      : { payload: scenario.payload as object }),
  });
  // A successful /vcs/show body is file content: compare its exact bytes.
  const raw = res.statusCode < 400 && scenario.url.startsWith('/vcs/show');
  return record(res, wire, raw);
}
