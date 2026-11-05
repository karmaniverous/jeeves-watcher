/**
 * @module api/catalog/ruleSchemas.test
 * Resolved rule schemas shared by the facet routes: configured then virtual rules, a rule without a schema has no properties, resolution is cached until the rules change, and the held rule names.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InferenceRule } from '../../config/types';
import { makeConfig } from '../../test/facetsDeps';

const mergeSchemas = vi.hoisted(() => vi.fn());
vi.mock('../../rules/schemaMerge', () => ({ mergeSchemas }));

const { createRuleSchemas, heldRuleNames, selectSchemas } =
  await import('./ruleSchemas');

const rule = (name: string, field?: string): InferenceRule => ({
  name,
  description: name,
  match: {},
  ...(field
    ? { schema: [{ properties: { [field]: { type: 'string' } } }] }
    : {}),
});

beforeEach(() => {
  mergeSchemas.mockReset();
  mergeSchemas.mockImplementation(
    (schema: Array<{ properties: Record<string, unknown> }>) => ({
      properties: schema[0].properties,
    }),
  );
});

describe('createRuleSchemas', () => {
  it('resolves configured rules, then virtual rules (a rule without a schema has none)', () => {
    const read = createRuleSchemas('/cfg');
    const schemas = read(makeConfig([rule('a', 'x'), rule('b')]), {
      src: [rule('v', 'y')],
    });
    expect(schemas).toEqual({
      configured: [
        { rule: 'a', properties: { x: { type: 'string' } } },
        { rule: 'b', properties: {} },
      ],
      virtual: [{ rule: 'v', properties: { y: { type: 'string' } } }],
    });
    expect(mergeSchemas).toHaveBeenCalledWith(expect.any(Array), {
      globalSchemas: {},
      configDir: '/cfg',
    });
  });

  it('caches until the configured or virtual rules change', () => {
    const read = createRuleSchemas('/cfg');
    const config = makeConfig([rule('a', 'x')]);
    read(config);
    read(config, {});
    expect(mergeSchemas).toHaveBeenCalledTimes(1);
    read(config, { src: [rule('v', 'y')] });
    expect(mergeSchemas).toHaveBeenCalledTimes(3);
    read(makeConfig([rule('a', 'z')]), { src: [rule('v', 'y')] });
    expect(mergeSchemas).toHaveBeenCalledTimes(5);
  });

  it('treats a config without inferenceRules as no configured rules', () => {
    const config = { ...makeConfig(), inferenceRules: undefined };
    expect(createRuleSchemas('/cfg')(config)).toEqual({
      configured: [],
      virtual: [],
    });
    expect(heldRuleNames(config, { s: [rule('v')] })).toEqual(new Set(['v']));
  });

  it('throws when a schema cannot be resolved', () => {
    mergeSchemas.mockImplementation(() => {
      throw new Error('missing schema');
    });
    expect(() =>
      createRuleSchemas('/cfg')(makeConfig([rule('a', 'x')])),
    ).toThrow('missing schema');
  });
});

describe('selectSchemas', () => {
  const s = (name: string) => ({ rule: name, properties: {} });
  const schemas = { configured: [s('a'), s('b')], virtual: [s('v')] };

  it.each([
    ['unscoped, configured only', undefined, 'configured', ['a', 'b']],
    ['unscoped, every rule', undefined, 'all', ['a', 'b', 'v']],
    ['scoped (configured only ignored)', ['v', 'a'], 'configured', ['a', 'v']],
    ['scoped', ['b'], 'all', ['b']],
  ] as const)('%s', (_label, scope, unscoped, expected) => {
    expect(
      selectSchemas(
        schemas,
        scope ? new Set<string>(scope) : undefined,
        unscoped,
      ).map((r) => r.rule),
    ).toEqual(expected);
  });
});

describe('heldRuleNames', () => {
  it('holds configured and virtual rule names', () => {
    expect(
      heldRuleNames(makeConfig([rule('a')]), { s1: [rule('v')], s2: [] }),
    ).toEqual(new Set(['a', 'v']));
    expect(heldRuleNames(makeConfig())).toEqual(new Set());
  });
});
