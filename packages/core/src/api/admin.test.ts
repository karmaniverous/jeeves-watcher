/**
 * @module api/admin.test
 * Administrative request schemas: accepted bodies and the first-issue messages the service answers with.
 */

import { describe, expect, it } from 'vitest';

import {
  pointsDeleteRequestSchema,
  rulesReapplyRequestSchema,
  rulesRegisterRequestSchema,
  rulesUnregisterRequestSchema,
} from './admin';

const firstMessage = (result: {
  success: boolean;
  error?: { issues: Array<{ message: string }> };
}) => result.error?.issues[0]?.message;

describe('pointsDeleteRequestSchema', () => {
  it('accepts an object filter and rejects anything else', () => {
    expect(pointsDeleteRequestSchema.safeParse({ filter: {} }).success).toBe(
      true,
    );
    for (const filter of [undefined, [], 'x']) {
      expect(
        firstMessage(pointsDeleteRequestSchema.safeParse({ filter })),
      ).toBe('Missing required field: filter (object)');
    }
  });
});

describe('rulesRegisterRequestSchema', () => {
  it('accepts named rules and keeps their other fields', () => {
    const parsed = rulesRegisterRequestSchema.parse({
      source: 'p',
      rules: [{ name: 'r', match: {} }],
    });
    expect(parsed.rules[0]).toEqual({ name: 'r', match: {} });
  });

  it.each([
    [{ rules: [] }, 'Missing required field: source'],
    [{ source: '', rules: [] }, 'Missing required field: source'],
    [{ source: 'p' }, 'Missing required field: rules (array)'],
  ])('%j → %s', (body, message) => {
    expect(firstMessage(rulesRegisterRequestSchema.safeParse(body))).toBe(
      message,
    );
  });

  it.each([[{}], [{ name: '' }], ['rule']])(
    'rejects rule %j: every rule needs a name',
    (rule) => {
      expect(
        firstMessage(
          rulesRegisterRequestSchema.safeParse({ source: 'p', rules: [rule] }),
        ),
      ).toBe('Every rule must be an object with a name');
    },
  );
});

describe('rulesUnregisterRequestSchema', () => {
  it('requires a non-empty source', () => {
    expect(
      rulesUnregisterRequestSchema.safeParse({ source: 'p' }).success,
    ).toBe(true);
    expect(firstMessage(rulesUnregisterRequestSchema.safeParse({}))).toBe(
      'Missing required field: source',
    );
  });
});

describe('rulesReapplyRequestSchema', () => {
  it.each([[undefined], [[]], [['']], ['x']])('rejects globs %j', (globs) => {
    expect(rulesReapplyRequestSchema.safeParse({ globs }).success).toBe(false);
  });

  it('accepts a non-empty glob list', () => {
    expect(rulesReapplyRequestSchema.parse({ globs: ['**/*.md'] })).toEqual({
      globs: ['**/*.md'],
    });
  });
});
