/**
 * @module api/catalog/countFacetsHandler
 * Catalog handler for `POST /search/facets/counts` (spec Design 12, A8): per-field approximate value counts (D194) or `{ min, max }` over the documents matching a filter, each document once. Answers 503 until the system indexes it needs are ready, counts at most 4 fields at a time within a 10 s budget (503 naming the fields not counted past it), and logs slow requests. No cache. Qdrant I/O through the facet store.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import {
  COUNT_FACETS_DEFAULT_LIMIT,
  type CountFacetsRequest,
  type CountFacetsResponse,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { InferenceRule, JeevesWatcherConfig } from '../../config/types';
import {
  FIELD_CHUNK_INDEX,
  FIELD_MATCHED_RULES,
} from '../../processor/payloadFields';
import type { FacetStore } from '../../vectorStore';
import { RequestError, withFilterErrors } from '../requestError';
import { OUT_OF_BUDGET, runBounded, withinBudget } from './boundedRun';
import type { Entry } from './catalogEntry';
import { countFilter, type FieldPlan, planFields } from './countFacetsPlan';
import { requireKnownRules } from './facetRules';
import {
  createRuleSchemas,
  heldRuleNames,
  type RuleSchema,
  type RuleSchemas,
  selectSchemas,
} from './ruleSchemas';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Fields counted at once (D96). */
export const COUNT_FACETS_CONCURRENCY = 4;

/** Time budget of one request, ms (D96). */
export const COUNT_FACETS_BUDGET_MS = 10_000;

/** Requests slower than this are logged at `info`, ms. */
export const COUNT_FACETS_SLOW_MS = 500;

/** Dependencies for the catalog `countFacets` entry's handler. */
export interface CatalogCountFacetsDeps {
  /** Live config getter (rule names and schemas). */
  getConfig: () => JeevesWatcherConfig;
  /** Virtual rules by source (accepted in `rules`). */
  getVirtualRules?: () => Record<string, InferenceRule[]>;
  /** Config directory for resolving schema file paths. */
  configDir: string;
  /** Facet reads (the vector store client). */
  facetStore: FacetStore;
  /** Logger. */
  logger: pino.Logger;
  /** Budget override, ms (tests). */
  budgetMs?: number;
}

type Counts = CountFacetsResponse['counts'];

/** `503 not_available` unless every needed system index is ready. */
function requireIndexes(store: FacetStore, fields: readonly string[]): void {
  for (const field of fields) {
    const state = store.systemIndexState(field);
    if (state !== 'ready') {
      throw new RequestError(
        'not_available',
        `System index ${field} is not ready`,
        {
          message: `Facet counts need the ${field} payload index, which is ${state ?? 'not started'}.`,
          details: { index: field, state: state ?? null },
        },
      );
    }
  }
}

/**
 * The in-scope rule schemas that resolved. A rule whose schema failed is
 * left out (logged), so its fields' modes come from the other rules or the
 * index types.
 */
function inScopeSchemas(
  schemas: RuleSchemas,
  scope: ReadonlySet<string> | undefined,
  logger: pino.Logger,
): RuleSchema[] {
  const selected = selectSchemas(schemas, scope, 'all');
  const failed = selected.filter((s) => 'error' in s);
  if (failed.length > 0) {
    logger.warn(
      { rules: failed.map((s) => s.rule), err: failed[0].error },
      'countFacets: rule schemas failed to resolve; those rules give no uiHints',
    );
  }
  return selected.filter((s) => !('error' in s));
}

/** The `503` for fields not counted within the 10 s budget. */
function budgetExceeded(pending: readonly string[]): RequestError {
  return new RequestError(
    'not_available',
    'Facet counts exceeded the time budget',
    {
      message: `Not counted within the request's ${String(COUNT_FACETS_BUDGET_MS / 1000)} s budget: ${pending.join(', ')}. Count fewer fields or narrow the filter.`,
      details: { pending: [...pending] },
    },
  );
}

/**
 * Count the planned fields within the budget.
 *
 * @returns The counts, by field in plan order.
 * @throws `503 not_available` naming the fields not counted in time.
 */
async function countPlanned(
  store: FacetStore,
  plans: readonly FieldPlan[],
  filter: Record<string, unknown>,
  limit: number,
  budgetMs: number,
): Promise<Counts> {
  const { results, pending } = await runBounded<Counts[string]>(
    plans.map(({ field, mode }) => ({
      key: field,
      run: async (timeoutS) => {
        const read = { field, filter, timeoutS };
        if (mode === 'counts') return store.facetCounts(read, limit);
        const [min, max] = await Promise.all([
          store.rangeBound(read, 'min'),
          store.rangeBound(read, 'max'),
        ]);
        return { min, max };
      },
    })),
    { concurrency: COUNT_FACETS_CONCURRENCY, budgetMs },
  );
  if (pending.length > 0) throw budgetExceeded(pending);
  return Object.fromEntries(
    plans.map(({ field }) => [field, results.get(field) as Counts[string]]),
  );
}

/**
 * Create the catalog handler for `POST /search/facets/counts`.
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogCountFacetsHandler(
  deps: CatalogCountFacetsDeps,
): CatalogHandler<Entry<'countFacets'>> {
  const ruleSchemas = createRuleSchemas(deps.configDir);
  const budgetMs = deps.budgetMs ?? COUNT_FACETS_BUDGET_MS;

  const count = async (body: CountFacetsRequest): Promise<Counts> => {
    // The budget covers the whole request, the index-type read included.
    const deadline = Date.now() + budgetMs;
    const store = deps.facetStore;
    const config = deps.getConfig();
    const virtualRules = deps.getVirtualRules?.() ?? {};
    const rules =
      body.rules &&
      requireKnownRules(body.rules, heldRuleNames(config, virtualRules));
    requireIndexes(
      store,
      rules ? [FIELD_CHUNK_INDEX, FIELD_MATCHED_RULES] : [FIELD_CHUNK_INDEX],
    );

    const schemas = inScopeSchemas(
      ruleSchemas(config, virtualRules),
      rules ? new Set(rules) : undefined,
      deps.logger,
    );
    const indexTypes = await withinBudget(
      store.payloadIndexTypes(),
      deadline - Date.now(),
    );
    if (indexTypes === OUT_OF_BUDGET) {
      throw budgetExceeded([...new Set(body.fields)]);
    }
    const plans = planFields(body.fields, schemas, indexTypes);
    return withFilterErrors(
      countPlanned(
        store,
        plans,
        countFilter(body.filter, rules),
        body.limit ?? COUNT_FACETS_DEFAULT_LIMIT,
        deadline - Date.now(),
      ),
    );
  };

  return wrapCatalogHandler<Entry<'countFacets'>>(
    async ({ body }) => {
      const started = Date.now();
      try {
        return { body: { counts: await count(body) } };
      } finally {
        const durationMs = Date.now() - started;
        if (durationMs > COUNT_FACETS_SLOW_MS) {
          deps.logger.info(
            {
              fields: body.fields.length,
              filter: body.filter !== undefined,
              rules: body.rules !== undefined,
              durationMs,
            },
            'countFacets: slow request',
          );
        }
      }
    },
    deps.logger,
    'Facet counts',
  );
}
