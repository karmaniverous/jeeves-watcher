/**
 * @module vectorStore/payload.test
 * getPointPayload: `null` only for an empty retrieve; a failed read rejects (never "not indexed"). getPointsWithVectors drops vectorless points and makes no request for no ids. Payload set/delete are no-ops for empty input.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  deletePointsPayload,
  getPointPayload,
  getPointsWithVectors,
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

describe('getPointsWithVectors', () => {
  it('returns points with vectors and omits vectorless ones', async () => {
    const c = client(() =>
      Promise.resolve([
        { id: 'a', vector: [1], payload: { k: 1 } },
        { id: 'b', vector: null, payload: {} },
      ]),
    );
    await expect(getPointsWithVectors(c, 'col', ['a', 'b'])).resolves.toEqual([
      { id: 'a', vector: [1], payload: { k: 1 } },
    ]);
  });

  it('makes no request for no ids', async () => {
    const c = client(() => Promise.resolve([]));
    await expect(getPointsWithVectors(c, 'col', [])).resolves.toEqual([]);
    expect(c.retrieve).not.toHaveBeenCalled();
  });
});

describe('payload writes', () => {
  it('merges fields into the points and waits for the write', async () => {
    const c = client(() => Promise.resolve([]));
    await setPointsPayload(c, 'col', ['p', 'q'], { a: 1 });
    expect(c.setPayload).toHaveBeenCalledWith('col', {
      wait: true,
      points: ['p', 'q'],
      payload: { a: 1 },
    });
  });

  it('removes the keys from the points and waits for the write', async () => {
    const c = client(() => Promise.resolve([]));
    await deletePointsPayload(c, 'col', ['p', 'q'], ['a', 'b']);
    expect(c.deletePayload).toHaveBeenCalledWith('col', {
      wait: true,
      points: ['p', 'q'],
      keys: ['a', 'b'],
    });
  });

  it('skip the request when there are no ids or keys', async () => {
    const c = client(() => Promise.resolve([]));
    await setPointsPayload(c, 'col', [], { a: 1 });
    await deletePointsPayload(c, 'col', ['p'], []);
    await deletePointsPayload(c, 'col', [], ['a']);
    expect(c.setPayload).not.toHaveBeenCalled();
    expect(c.deletePayload).not.toHaveBeenCalled();
  });
});
