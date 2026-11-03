/**
 * @module test/wire/fixtureSchemas
 * Checks the watcher-core request and response schemas against the recorded 0.20.0 wire baseline: every successful answer parses under its route's response schema, and every request 0.20.0 accepted parses under its route's request schema. Reads the fixture file only.
 */

import {
  documentsAcceptedResponseSchema,
  documentsDeleteRequestSchema,
  documentsDeleteResponseSchema,
  documentsEnvelopeSchema,
  documentsResultsResponseSchema,
  getConfigSchemaResponseSchema,
  issuesResponseSchema,
  listFacetsResponseSchema,
  matchConfigRequestSchema,
  matchConfigResponseSchema,
  metadataRequestSchema,
  metadataResponseSchema,
  pointsDeleteRequestSchema,
  pointsDeleteResponseSchema,
  rebuildMetadataRequestSchema,
  rebuildMetadataResponseSchema,
  reindexRequestSchema,
  reindexResponseSchema,
  rulesReapplyRequestSchema,
  rulesReapplyResponseSchema,
  rulesRegisterRequestSchema,
  rulesRegisterResponseSchema,
  rulesUnregisterRequestSchema,
  rulesUnregisterResponseSchema,
  validateConfigRequestSchema,
  validateConfigResponseSchema,
  vcsCheckExclusionQuerySchema,
  vcsCheckExclusionResponseSchema,
  vcsDiffQuerySchema,
  vcsDiffResponseSchema,
  vcsExcludeRequestSchema,
  vcsExcludeResponseSchema,
  vcsHistoryQuerySchema,
  vcsHistoryResponseSchema,
  vcsRevertRequestSchema,
  vcsRevertResponseSchema,
  vcsStatusResponseSchema,
  walkRequestSchema,
  walkResponseSchema,
} from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { WireRecord, WireScenario } from './scenarios';
import { CATALOG_COMPLETION_SCENARIOS } from './scenariosCompletion';
import fixtures from './wire-0.20.0.json';

interface RouteSchemas {
  /** Body schema (POST/DELETE) or query schema (GET). */
  request?: z.ZodType;
  /** Schemas a 2xx body may match (any one). */
  response: z.ZodType[];
}

/** Route schemas keyed by the scenario name's first word. */
const ROUTES: Partial<Record<string, RouteSchemas>> = {
  configSchema: { response: [getConfigSchemaResponseSchema] },
  configMatch: {
    request: matchConfigRequestSchema,
    response: [matchConfigResponseSchema],
  },
  configValidate: {
    request: validateConfigRequestSchema,
    response: [validateConfigResponseSchema],
  },
  reindex: { request: reindexRequestSchema, response: [reindexResponseSchema] },
  issues: { response: [issuesResponseSchema] },
  facets: { response: [listFacetsResponseSchema] },
  rebuildMetadata: {
    request: rebuildMetadataRequestSchema,
    response: [rebuildMetadataResponseSchema],
  },
  metadata: {
    request: metadataRequestSchema,
    response: [metadataResponseSchema],
  },
  walk: { request: walkRequestSchema, response: [walkResponseSchema] },
  documents: {
    // The envelope, not the strict request: 0.20.0 rejects items one by one.
    request: documentsEnvelopeSchema,
    response: [documentsAcceptedResponseSchema, documentsResultsResponseSchema],
  },
  documentsDelete: {
    request: documentsDeleteRequestSchema,
    response: [documentsDeleteResponseSchema],
  },
  pointsDelete: {
    request: pointsDeleteRequestSchema,
    response: [pointsDeleteResponseSchema],
  },
  rulesRegister: {
    request: rulesRegisterRequestSchema,
    response: [rulesRegisterResponseSchema],
  },
  rulesUnregister: {
    request: rulesUnregisterRequestSchema,
    response: [rulesUnregisterResponseSchema],
  },
  rulesUnregisterBySource: { response: [rulesUnregisterResponseSchema] },
  rulesReapply: {
    request: rulesReapplyRequestSchema,
    response: [rulesReapplyResponseSchema],
  },
  vcsStatus: { response: [vcsStatusResponseSchema] },
  vcsHistory: {
    request: vcsHistoryQuerySchema,
    response: [vcsHistoryResponseSchema],
  },
  vcsDiff: { request: vcsDiffQuerySchema, response: [vcsDiffResponseSchema] },
  vcsCheckExclusion: {
    request: vcsCheckExclusionQuerySchema,
    response: [vcsCheckExclusionResponseSchema],
  },
  vcsRevert: {
    request: vcsRevertRequestSchema,
    response: [vcsRevertResponseSchema],
  },
  vcsExclude: {
    request: vcsExcludeRequestSchema,
    response: [vcsExcludeResponseSchema],
  },
};

const records = fixtures as Record<string, WireRecord>;

const routeOf = (scenario: WireScenario): RouteSchemas => {
  const route = ROUTES[scenario.name.split(' ')[0]];
  if (!route) throw new Error(`no schemas for ${scenario.name}`);
  return route;
};

/** The request input a route schema validates: query for GET, else body. */
const requestInput = (scenario: WireScenario): unknown =>
  scenario.method === 'GET'
    ? Object.fromEntries(new URL(scenario.url, 'http://x').searchParams)
    : (scenario.payload ?? {});

const ok = (scenario: WireScenario) => {
  const status = records[scenario.name].status;
  return status >= 200 && status < 300;
};

describe('0.20.0 wire baseline against watcher-core schemas', () => {
  it.each(CATALOG_COMPLETION_SCENARIOS.filter(ok).map((s) => [s.name, s]))(
    '%s: response parses',
    (_name, scenario) => {
      const { response } = routeOf(scenario);
      const body = records[scenario.name].body;
      expect(response.some((schema) => schema.safeParse(body).success)).toBe(
        true,
      );
    },
  );

  it.each(
    CATALOG_COMPLETION_SCENARIOS.filter(
      (s) => ok(s) && routeOf(s).request !== undefined,
    ).map((s) => [s.name, s]),
  )('%s: accepted request parses', (_name, scenario) => {
    const result = routeOf(scenario).request!.safeParse(requestInput(scenario));
    expect(result.error?.issues).toBeUndefined();
  });
});
