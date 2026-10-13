/**
 * @module processor/documentIdentity.test
 * Document identity: file point IDs unchanged (normalised pointId), source IDs from the exact reference, store keys, exactly one identity field family per point, Zod validation.
 */

import { describe, expect, it } from 'vitest';

import { pointId, sourcePointId } from '../pointId';
import {
  documentChunkIds,
  documentIdentitySchema,
  documentKey,
  documentPointId,
  identityPayload,
} from './documentIdentity';

const file = { kind: 'file', filePath: 'J:\\Docs\\A.md' } as const;
const source = { kind: 'source', ref: 'app://t/AbC', rule: 'chat' } as const;

describe('documentIdentity', () => {
  it('keeps file point IDs unchanged (normalised pointId)', () => {
    expect(documentPointId(file, 2)).toBe(pointId('j:/docs/a.md', 2));
    expect(documentChunkIds(file, 2)).toEqual([
      pointId(file.filePath, 0),
      pointId(file.filePath, 1),
    ]);
  });

  it('hashes the exact reference for source points', () => {
    expect(documentPointId(source, 0)).toBe(sourcePointId('app://t/AbC', 0));
    expect(documentPointId(source, 0)).not.toBe(
      sourcePointId('app://t/abc', 0),
    );
    expect(documentChunkIds(source, 2)).toEqual([
      sourcePointId(source.ref, 0),
      sourcePointId(source.ref, 1),
    ]);
  });

  it('keys stores by path or verbatim reference', () => {
    expect(documentKey(file)).toBe(file.filePath);
    expect(documentKey(source)).toBe('app://t/AbC');
  });

  it('emits exactly one identity field family', () => {
    expect(identityPayload(file)).toEqual({ file_path: 'J:/Docs/A.md' });
    expect(identityPayload(source)).toEqual({
      source: 'app://t/AbC',
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
