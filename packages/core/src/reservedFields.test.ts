/**
 * @module reservedFields.test
 * Tests for reserved system payload field helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  findReservedPropertyNames,
  isReservedPayloadField,
  RESERVED_PAYLOAD_FIELDS,
} from './reservedFields';

describe('reserved payload fields', () => {
  it('includes source identity and total_chunks', () => {
    expect(RESERVED_PAYLOAD_FIELDS).toContain('source');
    expect(RESERVED_PAYLOAD_FIELDS).toContain('source_rule');
    expect(RESERVED_PAYLOAD_FIELDS).toContain('total_chunks');
    expect(RESERVED_PAYLOAD_FIELDS).toHaveLength(12);
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
