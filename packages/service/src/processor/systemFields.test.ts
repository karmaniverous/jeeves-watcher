/**
 * @module processor/systemFields.test
 * withSystemFields: reserved names (matched_rules included) are dropped from rule/enrichment metadata, identity fields re-asserted, matched_rules written only from the pipeline's own list.
 */

import { describe, expect, it } from 'vitest';

import { withSystemFields } from './systemFields';

const source = { kind: 'source', ref: 'app://t/AbC', rule: 'chat' } as const;
const file = { kind: 'file', filePath: 'C:\\Docs\\A.md' } as const;

const hostile = {
  a: 1,
  matched_rules: ['enrichment'],
  file_path: 'evil',
  source: 'evil',
  source_rule: 'evil',
  chunk_index: 9,
  content_hash: 'x',
};

describe('withSystemFields', () => {
  it('re-asserts the normalised file identity, never source fields', () => {
    expect(withSystemFields(hostile, file)).toEqual({
      a: 1,
      file_path: 'C:/Docs/A.md',
    });
  });

  it('drops reserved names, re-asserts the source identity and writes matched_rules only from the pipeline list', () => {
    expect(withSystemFields(hostile, source, ['chat'])).toEqual({
      a: 1,
      matched_rules: ['chat'],
      source: 'app://t/AbC',
      source_rule: 'chat',
    });
  });

  it('leaves matched_rules out of a metadata-only write (stored value kept)', () => {
    expect(
      withSystemFields({ matched_rules: ['x'] }, source),
    ).not.toHaveProperty('matched_rules');
  });
});
