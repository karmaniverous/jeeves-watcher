/**
 * @module pointId/index.test
 * Golden values pin the point ID scheme: `sourcePointId` is UUIDv5 over the exact `<reference>#<chunk>` in the jeeves-watcher namespace (no normalisation), so stored source points keep their IDs across releases; file and source IDs differ because their keys do (a reference contains `://`, a normalised file path never does).
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

  it('gives distinct keys distinct IDs: a source reference never equals a normalised file path', () => {
    // Case-sensitive: these are two different references.
    expect(sourcePointId('app://chat/thread/1', 0)).not.toBe(
      sourcePointId('app://chat/Thread/1', 0),
    );
    // A file key is a normalised path, which never contains '://'; the
    // nearest file keys to a lower-case reference still hash differently.
    const lower = 'app://chat/thread/1';
    for (const file of [
      'app/chat/thread/1',
      '/app/chat/thread/1',
      'c:/app/chat/thread/1',
      'app:/chat/thread/1',
    ]) {
      expect(pointId(file, 0)).not.toBe(sourcePointId(lower, 0));
    }
    // Separation rests on the keys, not on the function: one key, one ID.
    expect(pointId(lower, 0)).toBe(sourcePointId(lower, 0));
  });
});
