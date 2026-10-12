import { describe, expect, it } from 'vitest';

import { pointId, sourcePointId } from '../pointId';
import {
  documentChunkIds,
  documentIdentitySchema,
  documentKey,
  documentPointId,
  identityPayload,
} from './documentIdentity';
import { withSystemFields } from './systemFields';

const file = { kind: 'file', filePath: 'J:\\Docs\\A.md' } as const;
const source = { kind: 'source', ref: 'cg://t/AbC', rule: 'chat' } as const;

describe('documentIdentity', () => {
  it('keeps file point IDs unchanged (normalised pointId)', () => {
    expect(documentPointId(file, 2)).toBe(pointId('j:/docs/a.md', 2));
    expect(documentChunkIds(file, 2)).toEqual([
      pointId(file.filePath, 0),
      pointId(file.filePath, 1),
    ]);
  });

  it('hashes the exact reference for source points', () => {
    expect(documentPointId(source, 0)).toBe(sourcePointId('cg://t/AbC', 0));
    expect(documentPointId(source, 0)).not.toBe(sourcePointId('cg://t/abc', 0));
    expect(documentChunkIds(source, 2)).toEqual([
      sourcePointId(source.ref, 0),
      sourcePointId(source.ref, 1),
    ]);
  });

  it('keys stores by path or verbatim reference', () => {
    expect(documentKey(file)).toBe(file.filePath);
    expect(documentKey(source)).toBe('cg://t/AbC');
  });

  it('emits exactly one identity field family', () => {
    expect(identityPayload(file)).toEqual({ file_path: 'J:/Docs/A.md' });
    expect(identityPayload(source)).toEqual({
      source: 'cg://t/AbC',
      source_rule: 'chat',
    });
  });

  it('validates identities with Zod', () => {
    expect(documentIdentitySchema.safeParse(source).success).toBe(true);
    expect(
      documentIdentitySchema.safeParse({ ...source, ref: 'j:/x' }).success,
    ).toBe(false);
  });
});

describe('withSystemFields', () => {
  it('drops reserved names, keeps matched_rules, re-asserts identity', () => {
    const out = withSystemFields(
      {
        a: 1,
        matched_rules: ['r'],
        file_path: 'evil',
        source: 'evil',
        chunk_index: 9,
        content_hash: 'x',
      },
      source,
    );
    expect(out).toEqual({
      a: 1,
      matched_rules: ['r'],
      source: 'cg://t/AbC',
      source_rule: 'chat',
    });
  });
});
