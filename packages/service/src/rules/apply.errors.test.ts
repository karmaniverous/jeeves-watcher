/**
 * @module rules/apply.errors.test
 * applyRules interpolation errors: schema `set`, renderDoc and template failures are returned in `errors` (rule, stage, message) and logged; successful rules report none.
 */

import { describe, expect, it, vi } from 'vitest';

import type { InferenceRule } from '../config/types';
import type { TemplateEngine } from '../templates';
import { applyRules } from './apply';
import type { RuleAttributes } from './attributes';
import { compileRules } from './compile';
import { formatRuleErrors } from './ruleErrors';

const attributes = {
  file: {
    path: '/a.json',
    directory: '/',
    filename: 'a.json',
    extension: '.json',
    sizeBytes: 1,
    modified: '',
  },
  json: { title: 'T' },
} as unknown as RuleAttributes;

const rule = (extra: Partial<InferenceRule>): InferenceRule => ({
  name: 'r',
  description: 'R',
  match: { type: 'object' },
  ...extra,
});

describe('applyRules errors', () => {
  it('reports a failing schema set and skips the rest of the rule', async () => {
    const logger = { warn: vi.fn() };
    const result = await applyRules(
      compileRules([
        rule({
          schema: [
            {
              type: 'object',
              properties: { t: { type: 'string', set: '{{noSuchHelper x}}' } },
            },
          ],
        }),
      ]),
      attributes,
      { logger },
    );
    expect(result.matchedRules).toEqual(['r']);
    expect(result.errors).toEqual([
      { rule: 'r', stage: 'schema', message: expect.any(String) as unknown },
    ]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('reports a failing template and falls back to raw content', async () => {
    const templateEngine = {
      hbs: undefined,
      render: () => {
        throw new Error('boom');
      },
    } as unknown as TemplateEngine;
    const result = await applyRules(
      compileRules([rule({ template: 't' })]),
      attributes,
      { logger: { warn: vi.fn() }, templateEngine },
    );
    expect(result.renderedContent).toBeNull();
    expect(result.errors).toEqual([
      { rule: 'r', stage: 'template', message: 'boom' },
    ]);
    expect(formatRuleErrors(result.errors)).toBe(
      'Rule "r" template failed: boom',
    );
  });

  it('reports nothing for a rule that applies cleanly', async () => {
    const result = await applyRules(
      compileRules([
        rule({
          schema: [
            {
              type: 'object',
              properties: { t: { type: 'string', set: '{{json.title}}' } },
            },
          ],
        }),
      ]),
      attributes,
    );
    expect(result.metadata).toEqual({ t: 'T' });
    expect(result.errors).toEqual([]);
  });
});
