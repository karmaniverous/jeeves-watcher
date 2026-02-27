import { describe, expect, it, vi } from 'vitest';

import { discoverPayloadFields, getCollectionInfo } from './collectionInfo';
import type { PayloadFieldSchema } from './types';

type MockClient = Parameters<typeof getCollectionInfo>[0];

function makeMockClient(overrides: Record<string, unknown> = {}): {
  client: MockClient;
  getCollectionMock: ReturnType<typeof vi.fn>;
  scrollMock: ReturnType<typeof vi.fn>;
} {
  const getCollectionMock = vi.fn().mockResolvedValue({
    points_count: 100,
    config: { params: { vectors: { size: 384 } } },
    payload_schema: {
      title: { data_type: 'keyword' },
      body: { data_type: 'text' },
    },
    ...overrides,
  });
  const scrollMock = vi.fn().mockResolvedValue({ points: [] });
  return {
    client: {
      getCollection: getCollectionMock,
      scroll: scrollMock,
    } as unknown as MockClient,
    getCollectionMock,
    scrollMock,
  };
}

describe('getCollectionInfo', () => {
  it('returns point count and dimensions from collection config', async () => {
    const { client } = makeMockClient();
    const info = await getCollectionInfo(client, 'test-col');

    expect(info.pointCount).toBe(100);
    expect(info.dimensions).toBe(384);
  });

  it('uses payload_schema when indexes exist', async () => {
    const { client, scrollMock } = makeMockClient();
    const info = await getCollectionInfo(client, 'test-col');

    expect(info.payloadFields).toEqual({
      title: { type: 'keyword' },
      body: { type: 'text' },
    });
    expect(scrollMock).not.toHaveBeenCalled();
  });

  it('discovers fields by sampling when no schema indexes', async () => {
    const { client, scrollMock } = makeMockClient({
      payload_schema: {},
      points_count: 10,
    });
    scrollMock.mockResolvedValue({
      points: [
        { id: '1', payload: { name: 'test', count: 42 } },
        { id: '2', payload: { name: 'other', active: true } },
      ],
    });

    const info = await getCollectionInfo(client, 'test-col');

    expect(info.payloadFields['name']).toEqual({ type: 'keyword' });
    expect(info.payloadFields['count']).toEqual({ type: 'integer' });
    expect(info.payloadFields['active']).toEqual({ type: 'bool' });
  });

  it('returns dimensions 0 when vectors config has no size', async () => {
    const { client, getCollectionMock } = makeMockClient();
    getCollectionMock.mockResolvedValue({
      points_count: 0,
      config: { params: { vectors: {} } },
      payload_schema: {},
    });

    const info = await getCollectionInfo(client, 'test-col');
    expect(info.dimensions).toBe(0);
  });

  it('handles missing points_count', async () => {
    const { client, getCollectionMock } = makeMockClient();
    getCollectionMock.mockResolvedValue({
      config: { params: { vectors: { size: 128 } } },
      payload_schema: {},
    });

    const info = await getCollectionInfo(client, 'test-col');
    expect(info.pointCount).toBe(0);
  });
});

describe('discoverPayloadFields', () => {
  it('populates target with inferred types from sampled points', async () => {
    const scrollMock = vi.fn().mockResolvedValue({
      points: [
        { id: '1', payload: { tag: 'a', score: 3.14, big: 'x'.repeat(300) } },
      ],
    });
    const client = { scroll: scrollMock } as unknown as MockClient;

    const target: Record<string, PayloadFieldSchema> = {};
    await discoverPayloadFields(client, 'col', target, 10);

    expect(target['tag']).toEqual({ type: 'keyword' });
    expect(target['score']).toEqual({ type: 'float' });
    expect(target['big']).toEqual({ type: 'text' });
  });

  it('does not overwrite existing fields in target', async () => {
    const scrollMock = vi.fn().mockResolvedValue({
      points: [{ id: '1', payload: { tag: 'a' } }],
    });
    const client = { scroll: scrollMock } as unknown as MockClient;

    const target: Record<string, PayloadFieldSchema> = {
      tag: { type: 'custom' },
    };
    await discoverPayloadFields(client, 'col', target);

    expect(target['tag'].type).toBe('custom');
  });
});
