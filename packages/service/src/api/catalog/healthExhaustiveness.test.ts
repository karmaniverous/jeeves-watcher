/**
 * @module api/catalog/healthExhaustiveness.test
 * D122: every key the `status` health source returns, with every feature on, is declared in `watcherHealthSchema`, and survives the catalog's `status` response schema (the server's serializer and the SDK's client parse with it). Each PR that adds a health field extends the feature set here.
 */

import {
  WATCHER_CATALOG,
  watcherHealthSchema,
} from '@karmaniverous/jeeves-watcher-core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { InitialScanTracker } from '../InitialScanTracker';
import { ReindexTracker } from '../ReindexTracker';
import { createCatalogStatusSource } from './statusHandler';

/** The object shape behind a schema, through optional/nullable wrappers. */
function shapeOf(
  schema: z.ZodType,
): Partial<Record<string, z.ZodType>> | undefined {
  const def = schema.def as {
    type: string;
    innerType?: z.ZodType;
    shape?: Record<string, z.ZodType>;
  };
  if (def.type === 'object') return def.shape;
  return def.innerType ? shapeOf(def.innerType) : undefined;
}

/** Key paths of `value` that `schema` does not declare. */
function undeclared(value: unknown, schema: z.ZodType, at = ''): string[] {
  const shape = shapeOf(schema);
  if (!shape || typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = at ? `${at}.${key}` : key;
    const field = shape[key];
    return field ? undeclared(child, field, path) : [path];
  });
}

/** Health with every feature on: a running reindex, both scan states, VCS. */
async function healthSamples(): Promise<Record<string, unknown>[]> {
  const reindexTracker = new ReindexTracker();
  reindexTracker.start('full');
  reindexTracker.setTotal(2);
  reindexTracker.incrementProcessed();
  const running = new InitialScanTracker();
  running.start();
  running.setMatched(3);
  running.incrementEnqueued();
  const done = new InitialScanTracker();
  done.start();
  done.complete();

  const samples: Record<string, unknown>[] = [];
  for (const initialScanTracker of [running, done]) {
    const source = createCatalogStatusSource({
      vectorStore: {
        getCollectionInfo: () =>
          Promise.resolve({ pointCount: 7, dimensions: 3 }),
      },
      getConfig: () => ({ vectorStore: { collectionName: 'watcher' } }),
      version: '1.2.3',
      reindexTracker,
      initialScanTracker,
      getVcsHealth: () => ({
        roots: 2,
        pending: 5,
        trippedRoots: 1,
        oldestTrippedAt: '2026-11-04T00:00:00.000Z',
      }),
    });
    samples.push((await source()).body.health);
  }
  return samples;
}

describe('status health exhaustiveness (D122)', () => {
  it('declares every health key in watcherHealthSchema', async () => {
    for (const health of await healthSamples()) {
      expect(undeclared(health, watcherHealthSchema)).toEqual([]);
    }
  });

  it('keeps every health key through the status response schema', async () => {
    const response = WATCHER_CATALOG.byName('status').response;
    for (const health of await healthSamples()) {
      const body = {
        name: 'watcher',
        version: '1.2.3',
        uptime: 1,
        status: 'healthy',
        health,
      };
      expect(response.parse(JSON.parse(JSON.stringify(body)))).toEqual(body);
    }
  });
});
