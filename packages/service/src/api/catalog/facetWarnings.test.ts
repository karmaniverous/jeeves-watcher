import { UI_HINTS } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { fakeStore, rule } from '../../test/countFacetsDeps';
import { makeConfig } from '../../test/facetsDeps';
import {
  checkFacetConfig,
  findUnindexedFacetFields,
  findUnknownUiHints,
  warnUnindexedFacetFields,
  warnUnknownUiHints,
} from './facetWarnings';
import { resolveRuleSchemas, type RuleSchema } from './ruleSchemas';

/** A silent logger whose `warn` is a spy. */
function spyLogger() {
  const logger = pino({ level: 'silent' });
  const warn = vi.spyOn(logger, 'warn');
  return { logger, warn };
}

/** One resolved rule schema. */
const schema = (
  name: string,
  properties: RuleSchema['properties'],
): RuleSchema => ({ rule: name, properties });

describe('findUnknownUiHints', () => {
  it('reports each unknown hint once, with its rule and property', () => {
    expect(
      findUnknownUiHints([
        schema('a', {
          ok: { type: 'string', uiHint: 'dropdown' },
          bad: { type: 'string', uiHint: 'selct' },
          plain: { type: 'string' },
          listed: { type: 'string', enum: ['x'] },
        }),
        schema('b', { n: { type: 'number', uiHint: 7 as unknown as string } }),
      ]),
    ).toEqual([
      { rule: 'a', property: 'bad', uiHint: 'selct' },
      { rule: 'b', property: 'n', uiHint: 7 },
    ]);
  });

  it.each(UI_HINTS.map((h) => [h]))('accepts the known hint %s', (hint) => {
    expect(
      findUnknownUiHints([
        schema('a', { f: { type: 'string', uiHint: hint } }),
      ]),
    ).toEqual([]);
  });

  it('skips a rule whose schema did not resolve', () => {
    expect(
      findUnknownUiHints([{ rule: 'x', properties: {}, error: new Error() }]),
    ).toEqual([]);
  });
});

describe('findUnindexedFacetFields', () => {
  it('lists facet fields with no index, with every declaring rule', () => {
    expect(
      findUnindexedFacetFields(
        [
          schema('a', {
            tag: { type: 'string', uiHint: 'tags' },
            status: { type: 'string', enum: ['open'] },
            note: { type: 'string' },
            nested: { type: 'object', uiHint: 'text' },
          }),
          schema('b', { status: { type: 'string', uiHint: 'select' } }),
        ],
        { tag: 'keyword' },
      ),
    ).toEqual([{ field: 'status', rules: ['a', 'b'] }]);
  });

  it('counts a system index as an index', () => {
    expect(
      findUnindexedFacetFields(
        [schema('a', { matched_rules: { type: 'array', uiHint: 'tags' } })],
        { matched_rules: 'keyword' },
      ),
    ).toEqual([]);
  });
});

describe('warnUnknownUiHints', () => {
  it('warns once per unknown hint, naming rule, property and hint', () => {
    const { logger, warn } = spyLogger();
    warnUnknownUiHints(
      [
        schema('a', {
          bad: { type: 'string', uiHint: 'selct' },
          good: { type: 'string', uiHint: 'select' },
        }),
      ],
      logger,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      {
        rule: 'a',
        property: 'bad',
        uiHint: 'selct',
        knownHints: UI_HINTS.join(', '),
      },
      expect.stringContaining(
        'Rule "a" property "bad" has an unknown uiHint "selct"',
      ),
    );
  });

  it('is silent for known hints and an enum without a hint', () => {
    const { logger, warn } = spyLogger();
    warnUnknownUiHints(
      [
        schema('a', {
          d: { type: 'string', uiHint: 'date' },
          e: { type: 'string', enum: ['x'] },
        }),
      ],
      logger,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('warnUnindexedFacetFields', () => {
  it('warns once per unindexed facet field and never for an indexed one', async () => {
    const { logger, warn } = spyLogger();
    await warnUnindexedFacetFields(
      [
        schema('a', {
          tag: { type: 'string', uiHint: 'tags' },
          status: { type: 'string', uiHint: 'select' },
        }),
      ],
      fakeStore(),
      logger,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { field: 'status', rules: ['a'] },
      expect.stringContaining('Facet field "status" has no payload index'),
    );
  });

  it('warns once and carries on when the indexes cannot be read', async () => {
    const { logger, warn } = spyLogger();
    await expect(
      warnUnindexedFacetFields(
        [schema('a', { status: { type: 'string', uiHint: 'select' } })],
        fakeStore({
          payloadIndexTypes: vi.fn(() => Promise.reject(new Error('down'))),
        }),
        logger,
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toBe(
      'Could not read the payload indexes to check the facet fields',
    );
  });
});

describe('checkFacetConfig', () => {
  const config = makeConfig([
    rule('a', {
      tag: { type: 'string', uiHint: 'tags' },
      odd: { type: 'string', uiHint: 'selct' },
    }),
  ]);

  it('warns about unknown hints and unindexed fields of the configured rules', async () => {
    const { logger, warn } = spyLogger();
    await checkFacetConfig({
      config,
      configDir: '/tmp',
      facetStore: fakeStore(),
      logger,
    });
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      {
        rule: 'a',
        property: 'odd',
        uiHint: 'selct',
        knownHints: UI_HINTS.join(', '),
      },
      { field: 'odd', rules: ['a'] },
    ]);
  });

  it('checks hints only without a facet store', async () => {
    const { logger, warn } = spyLogger();
    await checkFacetConfig({ config, configDir: '/tmp', logger });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('merges a hint declared by two schema references into one warning', async () => {
    const { logger, warn } = spyLogger();
    const twice = makeConfig([
      {
        ...rule('m'),
        schema: [
          { properties: { f: { type: 'string', uiHint: 'selct' } } },
          { properties: { f: { uiHint: 'selct' } } },
        ],
      },
    ]);
    expect(
      resolveRuleSchemas(twice.inferenceRules ?? [], twice, '/tmp'),
    ).toHaveLength(1);
    await checkFacetConfig({ config: twice, configDir: '/tmp', logger });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
