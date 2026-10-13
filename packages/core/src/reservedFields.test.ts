/**
 * @module reservedFields.test
 * Tests for reserved system payload field helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  findReservedPropertyNames,
  isReservedPayloadField,
  PAYLOAD_FIELD,
  RESERVED_PAYLOAD_FIELDS,
  SYSTEM_PAYLOAD_INDEX_FIELDS,
} from './reservedFields';

describe('reserved payload fields', () => {
  it('includes source identity and total_chunks', () => {
    expect(RESERVED_PAYLOAD_FIELDS).toContain('source');
    expect(RESERVED_PAYLOAD_FIELDS).toContain('source_rule');
    expect(RESERVED_PAYLOAD_FIELDS).toContain('total_chunks');
    expect(RESERVED_PAYLOAD_FIELDS).toHaveLength(12);
  });

  it('derives the list from the named constants, without duplicates', () => {
    expect([...RESERVED_PAYLOAD_FIELDS]).toEqual(Object.values(PAYLOAD_FIELD));
    expect(new Set(RESERVED_PAYLOAD_FIELDS).size).toBe(12);
    expect(PAYLOAD_FIELD.filePath).toBe('file_path');
  });

  it('system-indexed fields are source and source_rule', () => {
    expect(SYSTEM_PAYLOAD_INDEX_FIELDS).toEqual(['source', 'source_rule']);
  });

  it.each(RESERVED_PAYLOAD_FIELDS)('%s is reserved', (name) => {
    expect(isReservedPayloadField(name)).toBe(true);
  });

  it.each(['domain', 'sources', 'File_Path', 'chunk'])(
    '%s is not reserved',
    (name) => {
      expect(isReservedPayloadField(name)).toBe(false);
    },
  );

  it('finds reserved property names in input order', () => {
    expect(
      findReservedPropertyNames({
        title: {},
        source: {},
        domain: {},
        created_at: {},
      }),
    ).toEqual(['source', 'created_at']);
  });

  it('returns an empty list for missing properties', () => {
    expect(findReservedPropertyNames(undefined)).toEqual([]);
    expect(findReservedPropertyNames({ a: {} })).toEqual([]);
  });
});
