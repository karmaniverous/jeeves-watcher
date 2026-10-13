/**
 * @module schemas/payloadIndexes.test
 * Tests for the payload index config schema and its tenant/principal refinements.
 */

import { describe, expect, it } from 'vitest';

import {
  isPrincipalIndexType,
  isTenantIndexType,
  payloadIndexSchema,
  payloadIndexTypeSchema,
} from './payloadIndexes';
import { vectorStoreConfigSchema } from './services';

describe('payloadIndexSchema', () => {
  it.each(['keyword', 'integer', 'float', 'bool', 'datetime', 'uuid', 'text'])(
    'accepts type %s',
    (type) => {
      expect(payloadIndexSchema.safeParse({ field: 'f', type }).success).toBe(
        true,
      );
    },
  );

  it('rejects an unknown type', () => {
    expect(
      payloadIndexSchema.safeParse({ field: 'f', type: 'geo' }).success,
    ).toBe(false);
  });

  it('rejects an empty field', () => {
    expect(
      payloadIndexSchema.safeParse({ field: '', type: 'keyword' }).success,
    ).toBe(false);
  });

  it.each(['keyword', 'uuid'])('allows isTenant on %s', (type) => {
    expect(
      payloadIndexSchema.safeParse({ field: 'f', type, isTenant: true })
        .success,
    ).toBe(true);
  });

  it.each(['integer', 'float', 'bool', 'datetime', 'text'])(
    'rejects isTenant on %s',
    (type) => {
      const result = payloadIndexSchema.safeParse({
        field: 'f',
        type,
        isTenant: true,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(['isTenant']);
    },
  );

  it.each(['integer', 'float', 'datetime'])(
    'allows isPrincipal on %s',
    (type) => {
      expect(
        payloadIndexSchema.safeParse({ field: 'f', type, isPrincipal: true })
          .success,
      ).toBe(true);
    },
  );

  it.each(['keyword', 'uuid', 'bool', 'text'])(
    'rejects isPrincipal on %s',
    (type) => {
      const result = payloadIndexSchema.safeParse({
        field: 'f',
        type,
        isPrincipal: true,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(['isPrincipal']);
    },
  );

  it('allows explicit false flags on any type', () => {
    expect(
      payloadIndexSchema.safeParse({
        field: 'f',
        type: 'bool',
        isTenant: false,
        isPrincipal: false,
      }).success,
    ).toBe(true);
  });
});

describe('vectorStoreConfigSchema.payloadIndexes', () => {
  const base = { url: 'http://localhost:6333', collectionName: 'c' };

  it('is optional and has no default', () => {
    const parsed = vectorStoreConfigSchema.parse(base);
    expect(parsed.payloadIndexes).toBeUndefined();
  });

  it('accepts a list of indexes', () => {
    const parsed = vectorStoreConfigSchema.parse({
      ...base,
      payloadIndexes: [
        { field: 'user_id', type: 'keyword', isTenant: true },
        { field: 'to_ts', type: 'integer', isPrincipal: true },
      ],
    });
    expect(parsed.payloadIndexes).toHaveLength(2);
  });

  it('reports the failing array element', () => {
    const result = vectorStoreConfigSchema.safeParse({
      ...base,
      payloadIndexes: [{ field: 'x', type: 'text', isTenant: true }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual([
      'payloadIndexes',
      0,
      'isTenant',
    ]);
  });

  it('rejects a duplicate field, pointing at the second entry', () => {
    const result = vectorStoreConfigSchema.safeParse({
      ...base,
      payloadIndexes: [
        { field: 'user_id', type: 'keyword' },
        { field: 'to_ts', type: 'integer' },
        { field: 'user_id', type: 'uuid' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['payloadIndexes', 2, 'field'],
        message: expect.stringContaining('Duplicate') as unknown,
      }),
    ]);
  });

  it.each(['source', 'source_rule'])(
    'rejects the system-indexed field %s',
    (field) => {
      const result = vectorStoreConfigSchema.safeParse({
        ...base,
        payloadIndexes: [{ field, type: 'keyword' }],
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({
        path: ['payloadIndexes', 0, 'field'],
        message: expect.stringContaining('system field') as unknown,
      });
    },
  );
});

describe('isTenantIndexType / isPrincipalIndexType', () => {
  it('partition the index types exactly', () => {
    const types = payloadIndexTypeSchema.options;
    expect(types.filter(isTenantIndexType)).toEqual(['keyword', 'uuid']);
    expect(types.filter(isPrincipalIndexType)).toEqual([
      'integer',
      'float',
      'datetime',
    ]);
  });
});
