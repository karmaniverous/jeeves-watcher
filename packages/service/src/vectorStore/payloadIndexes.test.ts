/**
 * @module vectorStore/payloadIndexes.test
 * Unit tests for the payload index planner, Qdrant field-schema mapping and ensurePayloadIndexes (create missing, never drop, warn on type and tenant/principal flag mismatch).
 */

import type pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  ensurePayloadIndexes,
  type PayloadIndexClient,
  planPayloadIndexes,
  SYSTEM_PAYLOAD_INDEXES,
  toQdrantFieldSchema,
} from './payloadIndexes';

describe('planPayloadIndexes', () => {
  it('creates the system source/source_rule keyword indexes by default', () => {
    const plan = planPayloadIndexes(undefined, {});
    expect(plan.create).toEqual(SYSTEM_PAYLOAD_INDEXES);
    expect(plan.mismatches).toEqual([]);
  });

  it('adds configured indexes after the system ones', () => {
    const plan = planPayloadIndexes(
      [{ field: 'user_id', type: 'keyword', isTenant: true }],
      {},
    );
    expect(plan.create.map((i) => i.field)).toEqual([
      'source',
      'source_rule',
      'user_id',
    ]);
  });

  it('skips fields already indexed with the same type', () => {
    const plan = planPayloadIndexes(
      [{ field: 'user_id', type: 'keyword', isTenant: true }],
      {
        source: { data_type: 'keyword' },
        source_rule: { data_type: 'keyword' },
        user_id: { data_type: 'keyword' },
      },
    );
    expect(plan.create).toEqual([]);
    expect(plan.mismatches).toEqual([]);
  });

  it('reports a type mismatch and does not recreate the index', () => {
    const plan = planPayloadIndexes([{ field: 'created', type: 'datetime' }], {
      created: { data_type: 'integer' },
    });
    expect(plan.create.map((i) => i.field)).toEqual(['source', 'source_rule']);
    expect(plan.mismatches).toEqual([
      { field: 'created', expected: 'datetime', actual: 'integer' },
    ]);
  });

  it.each([
    [[{ field: 'source', type: 'keyword' as const, isTenant: true }]],
    [
      [
        { field: 'user_id', type: 'keyword' as const },
        { field: 'user_id', type: 'integer' as const },
      ],
    ],
  ])(
    'refuses a field declared twice (%j bypassed validation)',
    (configured) => {
      expect(() => planPayloadIndexes(configured, {})).toThrow(
        'declared twice',
      );
    },
  );

  it('ignores unrelated existing indexes (never drops)', () => {
    const plan = planPayloadIndexes(undefined, {
      chunk_text: { data_type: 'text' },
      source: { data_type: 'keyword' },
      source_rule: { data_type: 'keyword' },
    });
    expect(plan).toEqual({ create: [], mismatches: [], flagMismatches: [] });
  });

  it('reports an is_tenant / is_principal mismatch on a same-type index', () => {
    const plan = planPayloadIndexes(
      [
        { field: 'user_id', type: 'keyword', isTenant: true },
        { field: 'ts', type: 'integer' },
        { field: 'ok', type: 'keyword', isTenant: true },
      ],
      {
        source: { data_type: 'keyword' },
        source_rule: { data_type: 'keyword' },
        user_id: { data_type: 'keyword' },
        ts: { data_type: 'integer', params: { is_principal: true } },
        ok: { data_type: 'keyword', params: { is_tenant: true } },
      },
    );
    expect(plan.create).toEqual([]);
    expect(plan.flagMismatches).toEqual([
      { field: 'user_id', flag: 'is_tenant', expected: true, actual: false },
      { field: 'ts', flag: 'is_principal', expected: false, actual: true },
    ]);
  });
});

describe('toQdrantFieldSchema', () => {
  it.each([
    [{ field: 'f', type: 'keyword' as const }, 'keyword'],
    [
      { field: 'f', type: 'keyword' as const, isTenant: true },
      { type: 'keyword', is_tenant: true },
    ],
    [
      { field: 'f', type: 'uuid' as const, isTenant: true },
      { type: 'uuid', is_tenant: true },
    ],
    [
      { field: 'f', type: 'datetime' as const, isPrincipal: true },
      { type: 'datetime', is_principal: true },
    ],
    [
      { field: 'f', type: 'integer' as const, isPrincipal: true },
      { type: 'integer', is_principal: true },
    ],
    [{ field: 'f', type: 'bool' as const }, 'bool'],
    [{ field: 'f', type: 'text' as const }, 'text'],
    [{ field: 'f', type: 'keyword' as const, isTenant: false }, 'keyword'],
  ])('%o → %o', (index, expected) => {
    expect(toQdrantFieldSchema(index)).toEqual(expected);
  });
});

function makeClient(payloadSchema: Record<string, { data_type: string }>) {
  const createPayloadIndex = vi.fn().mockResolvedValue({});
  const client = {
    getCollection: vi.fn().mockResolvedValue({ payload_schema: payloadSchema }),
    createPayloadIndex,
  } as unknown as PayloadIndexClient;
  return { client, createPayloadIndex };
}

function makeLogger() {
  return { warn: vi.fn(), info: vi.fn() };
}

describe('ensurePayloadIndexes', () => {
  it('creates missing indexes with mapped Qdrant schemas', async () => {
    const { client, createPayloadIndex } = makeClient({
      source: { data_type: 'keyword' },
    });
    const logger = makeLogger();

    await ensurePayloadIndexes(
      client,
      'col',
      [{ field: 'user_id', type: 'keyword', isTenant: true }],
      logger as unknown as pino.Logger,
    );

    expect(createPayloadIndex.mock.calls).toEqual([
      [
        'col',
        { field_name: 'source_rule', field_schema: 'keyword', wait: true },
      ],
      [
        'col',
        {
          field_name: 'user_id',
          field_schema: { type: 'keyword', is_tenant: true },
          wait: true,
        },
      ],
    ]);
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns on a type mismatch and leaves the index alone', async () => {
    const { client, createPayloadIndex } = makeClient({
      source: { data_type: 'keyword' },
      source_rule: { data_type: 'keyword' },
      user_id: { data_type: 'integer' },
    });
    const logger = makeLogger();

    await ensurePayloadIndexes(
      client,
      'col',
      [{ field: 'user_id', type: 'keyword', isTenant: true }],
      logger as unknown as pino.Logger,
    );

    expect(createPayloadIndex).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'user_id',
        expected: 'keyword',
        actual: 'integer',
      }),
      expect.stringContaining('differs from the desired index'),
    );
  });

  it('warns on an is_tenant mismatch and leaves the index alone', async () => {
    const { client, createPayloadIndex } = makeClient({
      source: { data_type: 'keyword' },
      source_rule: { data_type: 'keyword' },
      user_id: { data_type: 'keyword' },
    });
    const logger = makeLogger();

    await ensurePayloadIndexes(
      client,
      'col',
      [{ field: 'user_id', type: 'keyword', isTenant: true }],
      logger as unknown as pino.Logger,
    );

    expect(createPayloadIndex).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'user_id',
        flag: 'is_tenant',
        expected: true,
        actual: false,
      }),
      expect.stringContaining('is_tenant differs'),
    );
  });

  it('wraps a creation failure with the field name', async () => {
    const { client, createPayloadIndex } = makeClient({});
    createPayloadIndex.mockRejectedValueOnce(new Error('boom'));

    await expect(
      ensurePayloadIndexes(client, 'col', undefined),
    ).rejects.toThrow(
      'Failed to create payload index on "source": Error: boom',
    );
  });
});
