/**
 * @module api/catalog/facetsHandler.values.test
 * Tests for the GET /search/facets lister (createFacetsLister): which facets aggregate live values, and graceful degradation on a bad rule schema.
 */

import { describe, expect, it, vi } from 'vitest';

import { makeConfig, makeDeps, makeValuesManager } from '../../test/facetsDeps';
import { createFacetsLister } from './facetsHandler';

describe('GET /search/facets handler', () => {
  it('skips live value aggregation for non-enumerated uiHint types', () => {
    const config = makeConfig([
      {
        name: 'rule',
        description: 'R',
        match: {},
        schema: [
          {
            properties: {
              title: { type: 'string', uiHint: 'text' },
              issue_key: { type: 'string', uiHint: 'number' },
              domain: { type: 'string', uiHint: 'dropdown' },
            },
          },
        ],
      },
    ]);
    const values = makeValuesManager({
      rule: {
        title: ['Doc A', 'Doc B', 'Doc C'],
        issue_key: ['PROJ-1', 'PROJ-2', 'PROJ-3'],
        domain: ['slack', 'email'],
      },
    });

    const handler = createFacetsLister(
      makeDeps({ getConfig: () => config, valuesManager: values }),
    );
    const result = handler();

    const titleFacet = result.facets.find((f) => f.field === 'title');
    const keyFacet = result.facets.find((f) => f.field === 'issue_key');
    const domainFacet = result.facets.find((f) => f.field === 'domain');

    // Non-enumerated hints: empty values
    expect(titleFacet?.values).toEqual([]);
    expect(keyFacet?.values).toEqual([]);
    // Enumerated hint: live values populated
    expect(domainFacet?.values).toEqual(['email', 'slack']);
  });

  it('still returns enum values even for non-enumerated uiHint types', () => {
    const config = makeConfig([
      {
        name: 'rule',
        description: 'R',
        match: {},
        schema: [
          {
            properties: {
              status: {
                type: 'string',
                uiHint: 'text',
                enum: ['open', 'closed'],
              },
            },
          },
        ],
      },
    ]);
    const values = makeValuesManager({
      rule: { status: ['open', 'closed', 'pending'] },
    });

    const handler = createFacetsLister(
      makeDeps({ getConfig: () => config, valuesManager: values }),
    );
    const result = handler();

    // Explicit enum always wins, regardless of uiHint
    expect(result.facets[0].values).toEqual(['open', 'closed']);
  });

  it('aggregates values for tags and multiselect uiHint types', () => {
    const config = makeConfig([
      {
        name: 'rule',
        description: 'R',
        match: {},
        schema: [
          {
            properties: {
              labels: { type: 'string', uiHint: 'tags' },
              assignees: { type: 'string', uiHint: 'multiselect' },
            },
          },
        ],
      },
    ]);
    const values = makeValuesManager({
      rule: {
        labels: ['bug', 'feature'],
        assignees: ['alice', 'bob'],
      },
    });

    const handler = createFacetsLister(
      makeDeps({ getConfig: () => config, valuesManager: values }),
    );
    const result = handler();

    const labelsFacet = result.facets.find((f) => f.field === 'labels');
    const assigneesFacet = result.facets.find((f) => f.field === 'assignees');

    expect(labelsFacet?.values).toEqual(['bug', 'feature']);
    expect(assigneesFacet?.values).toEqual(['alice', 'bob']);
  });
  // B2 (#159): graceful degradation when inference rule schema is bad
  it('returns empty facets and logs error when schema merging throws (#159)', () => {
    const loggerMock = { error: vi.fn() };
    const config = makeConfig([
      {
        name: 'bad-rule',
        description: 'Rule with bad schema reference',
        match: {},
        // Schema reference pointing to a non-existent file triggers mergeSchemas to throw
        schema: ['/nonexistent/path/that/will/throw.json'] as never,
      },
    ]);
    const handler = createFacetsLister(
      makeDeps({
        getConfig: () => config,
        logger: loggerMock as never,
      }),
    );
    const result = handler();

    // Should return empty facets rather than crashing
    expect(result).toEqual({ facets: [] });
    // Error should have been logged
    expect(loggerMock.error).toHaveBeenCalled();
    const call = loggerMock.error.mock.calls[0] as unknown[];
    expect(call[0]).toHaveProperty('err');
    expect(call[1]).toContain('facets');
  });
});
