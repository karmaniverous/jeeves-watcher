/**
 * @module rules/reservedFieldWarnings.test
 * Tests for reserved system field warnings on inference-rule schemas.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findReservedFieldWarnings } from './reservedFieldWarnings';

describe('findReservedFieldWarnings', () => {
  it('returns nothing when no rule uses a reserved name', () => {
    expect(
      findReservedFieldWarnings({
        inferenceRules: [
          {
            name: 'r',
            schema: [{ type: 'object', properties: { domain: {} } }],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('warns for inline schema properties', () => {
    const warnings = findReservedFieldWarnings({
      inferenceRules: [
        {
          name: 'r',
          schema: [
            {
              type: 'object',
              properties: { source: {}, title: {}, total_chunks: {} },
            },
          ],
        },
      ],
    });
    expect(warnings.map((w) => w.path)).toEqual([
      'inferenceRules[r].schema.source',
      'inferenceRules[r].schema.total_chunks',
    ]);
    expect(warnings[0].message).toContain('reserved');
  });

  it('warns for named global schemas and file-based schemas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jw-reserved-'));
    writeFileSync(
      join(dir, 'file-schema.json'),
      JSON.stringify({ type: 'object', properties: { file_path: {} } }),
    );
    const warnings = findReservedFieldWarnings(
      {
        schemas: {
          named: { type: 'object', properties: { created_at: {} } },
          fromFile: 'file-schema.json',
        },
        inferenceRules: [{ name: 'r', schema: ['named', 'fromFile'] }],
      },
      dir,
    );
    expect(warnings.map((w) => w.path)).toEqual([
      'inferenceRules[r].schema.created_at',
      'inferenceRules[r].schema.file_path',
    ]);
  });

  it('skips string rule refs, schema-less rules and unresolvable schemas', () => {
    expect(
      findReservedFieldWarnings({
        inferenceRules: [
          'rules/a.json',
          { name: 'no-schema' },
          { name: 'missing-ref', schema: ['nope'] },
        ],
      }),
    ).toEqual([]);
  });
});
