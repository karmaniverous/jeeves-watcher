/**
 * @module vectorStore/payload.test
 * getPointPayload: `null` only for an empty retrieve; a failed read rejects (never "not indexed"). Payload set/delete are no-ops for empty input.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  deletePointsPayload,
  getPointPayload,
  type PayloadClient,
  setPointsPayload,
} from './payload';

function client(retrieve: PayloadClient['retrieve']) {
  return {
    retrieve: vi.fn(retrieve),
    setPayload: vi.fn(),
    deletePayload: vi.fn(),
  } as unknown as PayloadClient & {
    setPayload: ReturnType<typeof vi.fn>;
    deletePayload: ReturnType<typeof vi.fn>;
  };
}

describe('getPointPayload', () => {
  it('returns the payload of the retrieved point', async () => {
    const c = client(() => Promise.resolve([{ id: 'p', payload: { a: 1 } }]));
    await expect(getPointPayload(c, 'col', 'p')).resolves.toEqual({ a: 1 });
  });

  it('returns null when the point does not exist', async () => {
    const c = client(() => Promise.resolve([]));
    await expect(getPointPayload(c, 'col', 'p')).resolves.toBeNull();
  });

  it('rejects when the read fails instead of reporting "not indexed"', async () => {
    const c = client(() => Promise.reject(new Error('qdrant down')));
    await expect(getPointPayload(c, 'col', 'p')).rejects.toThrow('qdrant down');
  });
});

describe('payload writes', () => {
  it('skip the request when there are no ids or keys', async () => {
    const c = client(() => Promise.resolve([]));
    await setPointsPayload(c, 'col', [], { a: 1 });
    await deletePointsPayload(c, 'col', ['p'], []);
    await deletePointsPayload(c, 'col', [], ['a']);
    expect(c.setPayload).not.toHaveBeenCalled();
    expect(c.deletePayload).not.toHaveBeenCalled();
  });
});
