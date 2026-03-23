/**
 * @module vectorStore/getPointsWithVectors.test
 * Tests for VectorStore.getPointsWithVectors interface method.
 */

import { describe, expect, it, vi } from 'vitest';

import type { VectorPoint, VectorStore } from './types';

function createMockVectorStore(
  points: VectorPoint[],
): Pick<VectorStore, 'getPointsWithVectors'> {
  return {
    getPointsWithVectors: vi.fn((ids: string[]) =>
      Promise.resolve(points.filter((p) => ids.includes(p.id))),
    ),
  };
}

describe('VectorStore.getPointsWithVectors', () => {
  it('returns points with vectors for known IDs', async () => {
    const store = createMockVectorStore([
      { id: 'a', vector: [0.1, 0.2], payload: { file_path: '/a.txt' } },
      { id: 'b', vector: [0.3, 0.4], payload: { file_path: '/b.txt' } },
    ]);

    const result = await store.getPointsWithVectors(['a', 'b']);
    expect(result).toHaveLength(2);
    expect(result[0].vector).toEqual([0.1, 0.2]);
    expect(result[1].vector).toEqual([0.3, 0.4]);
  });

  it('omits missing IDs', async () => {
    const store = createMockVectorStore([
      { id: 'a', vector: [0.1, 0.2], payload: { file_path: '/a.txt' } },
    ]);

    const result = await store.getPointsWithVectors(['a', 'missing']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('returns empty array for empty input', async () => {
    const store = createMockVectorStore([]);
    const result = await store.getPointsWithVectors([]);
    expect(result).toEqual([]);
  });
});
