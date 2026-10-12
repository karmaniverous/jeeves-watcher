import { describe, expect, it } from 'vitest';

import { compileRules } from './compile';
import {
  buildSourceAttributes,
  sourceAttributesSchema,
} from './sourceAttributes';

const attributes = buildSourceAttributes({
  ref: 'cg://chat/thread/1',
  name: 'cg',
  id: 'chat/thread/1',
  rule: 'chat',
  body: { userId: 'u1' },
  retrievedAt: new Date('2026-10-12T00:00:00.000Z'),
});

describe('buildSourceAttributes', () => {
  it('builds schema-valid attributes with no file key', () => {
    expect(sourceAttributesSchema.parse(attributes)).toEqual({
      source: {
        ref: 'cg://chat/thread/1',
        name: 'cg',
        id: 'chat/thread/1',
        rule: 'chat',
        retrievedAt: '2026-10-12T00:00:00.000Z',
      },
      json: { userId: 'u1' },
    });
    expect(attributes).not.toHaveProperty('file');
  });

  it('matches source rules and never file rules', () => {
    const [sourceRule, fileRule] = compileRules([
      {
        name: 's',
        description: 's',
        match: { type: 'object', required: ['source'] },
      },
      {
        name: 'f',
        description: 'f',
        match: {
          type: 'object',
          properties: {
            file: {
              type: 'object',
              properties: { path: { type: 'string', glob: '**' } },
            },
          },
          required: ['file'],
        },
      },
    ]);
    expect(sourceRule.validate(attributes)).toBe(true);
    expect(fileRule.validate(attributes)).toBe(false);
  });
});
