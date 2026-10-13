/**
 * @module pointId/index.test
 * Golden values pin the point ID scheme: `sourcePointId` is UUIDv5 over the exact `<reference>#<chunk>` in the jeeves-watcher namespace (no normalisation), so stored source points keep their IDs across releases.
 */

import { describe, expect, it } from 'vitest';

import { pointId, sourcePointId } from './index';

describe('sourcePointId', () => {
  // Computed independently: SHA-1 over namespace bytes + UTF-8 name, v5 bits.
  it.each([
    ['app://chat/thread/1', 0, 'f93397dd-20fe-5622-99b0-a0967da6e9c4'],
    ['app://chat/thread/1', 1, '8aebb4a5-3301-505d-8417-c702d592b676'],
    ['app://chat/Thread/1', 0, '5d0bf74d-9165-5edb-9a3f-af7a3120889b'],
    ['docs://a/b c/ü', 0, '0e7307b9-7d5a-55a9-8f75-8716669ea194'],
  ])('%s chunk %i → %s', (reference, chunk, expected) => {
    expect(sourcePointId(reference, chunk)).toBe(expected);
  });

  it('is case-sensitive and distinct from the file scheme', () => {
    expect(sourcePointId('app://chat/thread/1', 0)).not.toBe(
      sourcePointId('app://chat/Thread/1', 0),
    );
    expect(sourcePointId('app://chat/Thread/1', 0)).not.toBe(
      pointId('app://chat/Thread/1', 0),
    );
  });
});
