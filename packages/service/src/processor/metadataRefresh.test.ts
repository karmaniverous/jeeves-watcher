import { describe, expect, it } from 'vitest';

import { diffMetadata } from './metadataRefresh';

const stored = {
  source: 'app://t/1',
  source_rule: 'chat',
  chunk_text: 'x',
  content_hash: 'h',
  user_id: 'u1',
  tags: ['a', 'b'],
};

describe('diffMetadata', () => {
  it('is same when every projected value matches (deep)', () => {
    expect(
      diffMetadata(stored, {
        source: 'app://t/1',
        source_rule: 'chat',
        user_id: 'u1',
        tags: ['a', 'b'],
      }),
    ).toBe('same');
  });

  it('is changed when a value differs', () => {
    expect(
      diffMetadata(stored, {
        source: 'app://t/1',
        source_rule: 'chat',
        user_id: 'u2',
        tags: ['a', 'b'],
      }),
    ).toBe('changed');
  });

  it('is changed when a key is added or the rule changes', () => {
    expect(
      diffMetadata(stored, {
        source: 'app://t/1',
        source_rule: 'other',
        user_id: 'u1',
        tags: ['a', 'b'],
      }),
    ).toBe('changed');
  });

  it('is keysRemoved when a stored non-system key is no longer projected', () => {
    expect(
      diffMetadata(stored, {
        source: 'app://t/1',
        source_rule: 'chat',
        user_id: 'u1',
      }),
    ).toBe('keysRemoved');
  });
});
