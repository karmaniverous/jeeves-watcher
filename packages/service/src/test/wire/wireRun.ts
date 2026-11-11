/**
 * @module test/wire/wireRun
 * Runs a wire scenario against a {@link WireApp} and records what a client sees: status, the headers clients see and the body, with volatile values (temp paths, commit, uptime) normalised. No assertions.
 */

import type { LightMyRequestResponse } from 'fastify';

import { normalizeSlashes } from '../../util/normalizeSlashes';
import type { WireRecord, WireScenario } from './scenarios';
import { WIRE_AUTH, type WireApp } from './wireApp';

/**
 * Replace volatile values: status uptime, the temp root and commit hash.
 *
 * @param text - Serialised body.
 * @param wire - The wire app.
 * @returns The normalised text.
 */
function normalise(text: string, wire: WireApp): string {
  // Temp and working directories differ per run and platform; each is
  // replaced in its JSON-escaped, raw and forward-slash forms.
  const forms = (path: string) => [
    JSON.stringify(path).slice(1, -1),
    path,
    normalizeSlashes(path),
  ];
  let out = text.split(wire.vcsRoot).join('{root}');
  for (const [path, token] of [
    [wire.dir, '{dir}'],
    [process.cwd(), '{cwd}'],
  ] as const) {
    for (const form of forms(path)) out = out.split(form).join(token);
  }
  return out
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
 * Run one scenario (authenticated unless it says otherwise) from a reset
 * state and return the raw reply.
 *
 * @param wire - The wire app.
 * @param scenario - The scenario.
 * @returns The Fastify inject response.
 */
export async function injectScenario(
  wire: WireApp,
  scenario: WireScenario,
): Promise<LightMyRequestResponse> {
  await wire.reset();
  Object.assign(wire.state, scenario.state);
  await scenario.setup?.(wire.vcsRoot);
  const fill = (text: string) =>
    text.split('{root}').join(wire.vcsRoot).split('{commit}').join(wire.commit);
  const url = fill(scenario.url);
  const payload =
    scenario.payload === undefined
      ? undefined
      : (JSON.parse(fill(JSON.stringify(scenario.payload))) as unknown);
  const app = scenario.withoutVcs
    ? wire.appWithoutVcs
    : scenario.withoutSourceQueue
      ? wire.appWithoutSourceQueue
      : wire.app;
  const headers =
    scenario.auth === 'none'
      ? {}
      : scenario.auth === 'wrong'
        ? { authorization: 'Bearer not-the-key' }
        : WIRE_AUTH;
  return app.inject({
    method: scenario.method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
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
  const res = await injectScenario(wire, scenario);
  // A successful /vcs/show body is file content: compare its exact bytes.
  const raw = res.statusCode < 400 && scenario.url.startsWith('/vcs/show');
  return record(res, wire, raw);
}
