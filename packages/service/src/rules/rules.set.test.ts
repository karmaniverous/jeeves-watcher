/**
 * @module rules/rules.set.test
 * Rules engine schema `set` values: template variables (missing ones render empty), and later matching rules overriding earlier ones while every match applies.
 */

import { describe, expect, it } from 'vitest';

import type { InferenceRule } from '../config/types';
import { makeAttributes } from '../test/fileAttributes';
import { applyRules, compileRules } from './index';

describe('rules engine: set values', () => {
  it('resolves template variables', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'template-vars',
        description: 'Resolve template variables',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              source: { type: 'string', set: '{{file.path}}' },
              dir: { type: 'string', set: '{{file.directory}}' },
            },
          },
        ],
      },
    ];
    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result.metadata).toEqual({
      source: 'docs/readme.md',
      dir: 'docs',
    });
  });

  it('later rules override earlier ones', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'first-rule',
        description: 'First rule',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              priority: { type: 'string', set: 'low' },
              source: { type: 'string', set: 'first' },
            },
          },
        ],
      },
      {
        name: 'second-rule',
        description: 'Second rule overrides priority',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              priority: { type: 'string', set: 'high' },
            },
          },
        ],
      },
    ];
    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());
    expect(result.metadata).toEqual({ priority: 'high', source: 'first' });
  });

  it('applies multiple matching rules in order (all applied, later overrides)', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'multi-first',
        description: 'First matching rule',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              a: { type: 'integer', set: '1' },
              shared: { type: 'string', set: 'first' },
            },
          },
        ],
      },
      {
        name: 'multi-second',
        description: 'Second matching rule',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              b: { type: 'integer', set: '2' },
              shared: { type: 'string', set: 'second' },
            },
          },
        ],
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());

    expect(result.metadata).toEqual({ a: 1, b: 2, shared: 'second' });
  });

  it('treats missing template variables as empty string', async () => {
    const rules: InferenceRule[] = [
      {
        name: 'missing-vars',
        description: 'Handle missing template variables',
        match: { type: 'object' },
        schema: [
          {
            properties: {
              title: { type: 'string', set: '{{frontmatter.title}}' },
              path: { type: 'string', set: '{{file.path}}' },
            },
          },
        ],
      },
    ];

    const compiled = compileRules(rules);
    const result = await applyRules(compiled, makeAttributes());

    expect(result.metadata).toEqual({ title: '', path: 'docs/readme.md' });
  });
});
