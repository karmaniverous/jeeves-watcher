/**
 * @module api/reindexSourceScopes.plan.test
 * resolveSourceScope per scope (full forces, rules without a path filter, issues with stored or recorded rules, nothing for rules-with-path/path/prune or config-triggered runs) and withSourcePlan's plan arithmetic.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { doc, RULE, sourceReindexFixture } from '../test/sourceReindexFixture';
import { resolveSourceScope, withSourcePlan } from './reindexSourceScopes';

const A = 'app://a';
const B = 'other://b';

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

/** A fixture with A and B indexed. */
async function indexed() {
  const fx = sourceReindexFixture({ [A]: doc('u1', 'x'), [B]: doc('u2', 'y') });
  stop = () => fx.sourceQueue.stop();
  await fx.index(A, B);
  return fx;
}

describe('resolveSourceScope', () => {
  it('full: every indexed document, forced', async () => {
    const { deps } = await indexed();
    const scope = await resolveSourceScope(deps, 'full', undefined);
    expect(scope?.force).toBe(true);
    expect(scope?.total).toBe(2);
    expect(scope?.targets).toEqual(
      expect.arrayContaining([
        { ref: A, rule: RULE },
        { ref: B, rule: RULE },
      ]),
    );
  });

  it('rules without a path filter: every indexed document, not forced', async () => {
    const { deps } = await indexed();
    const scope = await resolveSourceScope(deps, 'rules', []);
    expect(scope?.force).toBe(false);
    expect(scope?.targets).toHaveLength(2);
  });

  it('issues: references with issues, by stored or recorded rule', async () => {
    const { deps, issues } = await indexed();
    issues.record(A, 'embedding_error', 'x');
    issues.record('app://never', 'source_unavailable', 'x', { rule: 'r2' });
    issues.record('/docs/a.md', 'extraction_error', 'x');
    const scope = await resolveSourceScope(deps, 'issues', undefined);
    expect(scope?.force).toBe(false);
    expect(scope?.total).toBe(2);
    expect(scope?.targets).toEqual(
      expect.arrayContaining([
        { ref: A, rule: RULE },
        { ref: 'app://never', rule: 'r2' },
      ]),
    );
  });

  it.each([
    ['rules with a path filter', 'rules', ['src/**']],
    ['path', 'path', ['a.md']],
    ['prune', 'prune', undefined],
  ] as const)('%s: none', async (_label, scope, path) => {
    const { deps } = await indexed();
    expect(
      await resolveSourceScope(deps, scope, path ? [...path] : undefined),
    ).toBeUndefined();
  });

  it('config-triggered runs (includeSources unset) cover no sources', async () => {
    const { deps } = await indexed();
    const fileOnly = { ...deps, includeSources: undefined };
    expect(
      await resolveSourceScope(fileOnly, 'full', undefined),
    ).toBeUndefined();
  });
});

describe('withSourcePlan', () => {
  const sources = {
    total: 3,
    targets: [
      { ref: 'app://1', rule: 'r' },
      { ref: 'app://2', rule: 'r' },
    ],
  };

  it('returns the plan unchanged without sources', () => {
    const plan = { total: 1, toProcess: 1, toDelete: 0, byRoot: { src: 1 } };
    expect(withSourcePlan(plan, undefined)).toBe(plan);
    expect(withSourcePlan(undefined, undefined)).toBeUndefined();
  });

  it('adds source counts and one byRoot entry per source name', () => {
    const plan = { total: 1, toProcess: 1, toDelete: 0, byRoot: { src: 1 } };
    expect(withSourcePlan(plan, sources)).toEqual({
      total: 4,
      toProcess: 3,
      toDelete: 0,
      byRoot: { src: 1, app: 2 },
    });
  });

  it('starts from an empty plan when there is no file plan', () => {
    expect(withSourcePlan(undefined, sources)).toEqual({
      total: 3,
      toProcess: 2,
      toDelete: 0,
      byRoot: { app: 2 },
    });
  });
});
