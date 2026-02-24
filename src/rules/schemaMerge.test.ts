/**
 * @module rules/schemaMerge.test
 * Tests for schema merging, type coercion, and validation.
 */

import { describe, expect, it } from 'vitest';

import {
  coerceType,
  extractSetValues,
  mergeSchemas,
  resolveAndCoerce,
  type ResolvedSchema,
  type SchemaReference,
  validateSchemaCompleteness,
} from './schemaMerge';

describe('mergeSchemas', () => {
  it('merges inline schemas left-to-right at property level', () => {
    const refs: SchemaReference[] = [
      {
        properties: {
          domain: { type: 'string', description: 'Content domain' },
          created: { type: 'integer', description: 'Creation timestamp' },
        },
      },
      {
        properties: {
          domain: { set: 'jira' },
          entity_type: { type: 'string', set: 'issue' },
        },
      },
    ];

    const result = mergeSchemas(refs);

    expect(result.properties.domain).toEqual({
      type: 'string',
      description: 'Content domain',
      set: 'jira',
    });
    expect(result.properties.created).toEqual({
      type: 'integer',
      description: 'Creation timestamp',
    });
    expect(result.properties.entity_type).toEqual({
      type: 'string',
      set: 'issue',
    });
  });

  it('resolves named schema references from global collection', () => {
    const refs: SchemaReference[] = [
      'base',
      { properties: { domain: { set: 'slack' } } },
    ];

    const globalSchemas = {
      base: {
        properties: {
          domain: { type: 'string', description: 'Content domain' },
          created: { type: 'integer' },
        },
      },
    };

    const result = mergeSchemas(refs, { globalSchemas });

    expect(result.properties.domain).toEqual({
      type: 'string',
      description: 'Content domain',
      set: 'slack',
    });
    expect(result.properties.created).toEqual({ type: 'integer' });
  });

  it('throws on unresolved named reference', () => {
    const refs: SchemaReference[] = ['nonexistent'];

    expect(() => mergeSchemas(refs)).toThrow(
      'Schema reference "nonexistent" not found',
    );
  });

  it('handles uiHint keyword', () => {
    const refs: SchemaReference[] = [
      {
        properties: {
          status: {
            type: 'string',
            uiHint: 'select',
            enum: ['To Do', 'Done'],
          },
        },
      },
    ];

    const result = mergeSchemas(refs);

    expect(result.properties.status.uiHint).toBe('select');
    expect(result.properties.status.enum).toEqual(['To Do', 'Done']);
  });
});

describe('extractSetValues', () => {
  it('extracts set templates from resolved schema', () => {
    const schema: ResolvedSchema = {
      properties: {
        domain: { type: 'string', set: 'jira' },
        status: { type: 'string', set: '${json.current.fields.status.name}' },
        created: { type: 'integer' },
      },
    };

    const result = extractSetValues(schema);

    expect(result).toEqual({
      domain: 'jira',
      status: '${json.current.fields.status.name}',
    });
  });

  it('returns empty object when no set values present', () => {
    const schema: ResolvedSchema = {
      properties: {
        domain: { type: 'string' },
        created: { type: 'integer' },
      },
    };

    const result = extractSetValues(schema);

    expect(result).toEqual({});
  });
});

describe('coerceType', () => {
  it('coerces string to integer', () => {
    expect(coerceType('42', 'integer')).toBe(42);
    expect(coerceType('3.14', 'integer')).toBeUndefined();
    expect(coerceType('not-a-number', 'integer')).toBeUndefined();
  });

  it('coerces string to number', () => {
    expect(coerceType('3.14', 'number')).toBe(3.14);
    expect(coerceType('42', 'number')).toBe(42);
    expect(coerceType('not-a-number', 'number')).toBeUndefined();
  });

  it('coerces string to boolean', () => {
    expect(coerceType('true', 'boolean')).toBe(true);
    expect(coerceType('false', 'boolean')).toBe(false);
    expect(coerceType('yes', 'boolean')).toBeUndefined();
  });

  it('parses JSON string to array', () => {
    expect(coerceType('["a","b","c"]', 'array')).toEqual(['a', 'b', 'c']);
    expect(coerceType('[1,2,3]', 'array')).toEqual([1, 2, 3]);
    expect(coerceType('not-json', 'array')).toBeUndefined();
  });

  it('parses JSON string to object', () => {
    expect(coerceType('{"key":"value"}', 'object')).toEqual({ key: 'value' });
    expect(coerceType('not-json', 'object')).toBeUndefined();
  });

  it('passes through already-typed values', () => {
    expect(coerceType(['a', 'b'], 'array')).toEqual(['a', 'b']);
    expect(coerceType({ key: 'val' }, 'object')).toEqual({ key: 'val' });
    expect(coerceType(true, 'boolean')).toBe(true);
  });

  it('returns undefined for null/empty/undefined', () => {
    expect(coerceType(null, 'integer')).toBeUndefined();
    expect(coerceType(undefined, 'integer')).toBeUndefined();
    expect(coerceType('', 'integer')).toBeUndefined();
  });
});

describe('resolveAndCoerce', () => {
  it('resolves templates and coerces to declared types', () => {
    const schema: ResolvedSchema = {
      properties: {
        domain: { type: 'string', set: 'jira' },
        issue_key: { type: 'string', set: '${json.entityKey}' },
        created: { type: 'integer', set: '${json.current.fields.created}' },
        priority: { type: 'number', set: '${json.priority}' },
      },
    };

    const attributes = {
      file: {
        path: 'test.json',
        directory: '',
        filename: '',
        extension: '',
        sizeBytes: 0,
        modified: '',
      },
      json: {
        entityKey: 'WEB-123',
        current: { fields: { created: '1735689600' } },
        priority: '3.5',
      },
    };

    const result = resolveAndCoerce(schema, attributes);

    expect(result).toEqual({
      domain: 'jira',
      issue_key: 'WEB-123',
      created: 1735689600,
      priority: 3.5,
    });
  });

  it('omits properties with failed coercion', () => {
    const schema: ResolvedSchema = {
      properties: {
        count: { type: 'integer', set: '${json.count}' },
      },
    };

    const attributes = {
      file: {
        path: 'test.json',
        directory: '',
        filename: '',
        extension: '',
        sizeBytes: 0,
        modified: '',
      },
      json: { count: 'not-a-number' },
    };

    const result = resolveAndCoerce(schema, attributes);

    expect(result).toEqual({});
  });

  it('omits properties with empty/null templates', () => {
    const schema: ResolvedSchema = {
      properties: {
        domain: { type: 'string', set: 'jira' },
        missing: { type: 'string', set: '${json.missing}' },
      },
    };

    const attributes = {
      file: {
        path: 'test.json',
        directory: '',
        filename: '',
        extension: '',
        sizeBytes: 0,
        modified: '',
      },
      json: {},
    };

    const result = resolveAndCoerce(schema, attributes);

    expect(result).toEqual({ domain: 'jira' });
  });
});

describe('validateSchemaCompleteness', () => {
  it('passes when all properties have types', () => {
    const schema: ResolvedSchema = {
      properties: {
        domain: { type: 'string' },
        created: { type: 'integer' },
      },
    };

    expect(() => {
      validateSchemaCompleteness(schema, 'test-rule');
    }).not.toThrow();
  });

  it('throws when a property lacks a type', () => {
    const schema: ResolvedSchema = {
      properties: {
        domain: { type: 'string' },
        broken: { set: 'value' },
      },
    };

    expect(() => {
      validateSchemaCompleteness(schema, 'test-rule');
    }).toThrow('Property "broken" in rule "test-rule" has no declared type');
  });
});
