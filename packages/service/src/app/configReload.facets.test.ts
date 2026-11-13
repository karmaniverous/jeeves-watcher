/**
 * @module app/configReload.facets.test
 * A config reload logs the reloaded rules' facet warnings (spec D206 (3), (4)): an unknown uiHint, and a facet field with no payload index read through the facet store.
 */

import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { makeConfig, makeDeps } from '../test/reloadHarness';
import { reloadConfig } from './configReload';

vi.mock('./initialization', async () => {
  const actual: Record<string, unknown> =
    await vi.importActual('./initialization');
  return {
    ...actual,
    buildTemplateEngineAndCustomMapLib: vi.fn().mockResolvedValue({
      templateEngine: undefined,
      customMapLib: undefined,
    }),
  };
});

vi.mock('../api/executeReindex', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  executeReindex: vi.fn().mockResolvedValue(undefined),
}));

/** The reloaded config: rule `r` with an unknown hint and an unindexed facet field. */
function reloaded(): JeevesWatcherConfig {
  return {
    ...makeConfig(),
    inferenceRules: [
      {
        name: 'r',
        description: 'r',
        match: {},
        schema: [
          {
            properties: {
              odd: { type: 'string', uiHint: 'selct' },
              tag: { type: 'string', uiHint: 'tags' },
            },
          },
        ],
      },
    ],
  };
}

/** Reload `reloaded()` with the given facet store; return the warn calls' first arguments. */
async function reload(facetStore?: {
  payloadIndexTypes: () => Promise<Record<string, string>>;
}) {
  const config = reloaded();
  const { logger, processor, factories } = makeDeps(config);
  const warn = vi.spyOn(logger, 'warn');
  await reloadConfig(
    { config: makeConfig(), watcher: undefined, gitignoreFilter: undefined },
    {
      configPath: '/path/to/config.json',
      factories,
      queue: {} as never,
      processor,
      logger,
      runtimeOptions: {},
      wiring: { initialScanTracker: {} as never },
      ...(facetStore ? { facetStore } : {}),
    },
  );
  return warn.mock.calls.map((c) => c[0] as Record<string, unknown>);
}

describe('reloadConfig facet warnings', () => {
  it('warns about an unknown hint and an unindexed facet field', async () => {
    const payloadIndexTypes = vi.fn(() => Promise.resolve({ tag: 'keyword' }));
    const warned = await reload({ payloadIndexTypes });
    expect(payloadIndexTypes).toHaveBeenCalledOnce();
    expect(warned).toEqual([
      expect.objectContaining({ rule: 'r', property: 'odd', uiHint: 'selct' }),
      { field: 'odd', rules: ['r'] },
    ]);
  });

  it('warns only about the hint without a facet store', async () => {
    expect(await reload()).toEqual([
      expect.objectContaining({ rule: 'r', property: 'odd' }),
    ]);
  });
});
