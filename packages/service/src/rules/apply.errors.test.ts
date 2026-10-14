/**
 * @module rules/apply.errors.test
 * applyRules interpolation errors: schema `set`, renderDoc and template failures are returned in `errors` (rule, stage, message) and logged; a schema failure skips the rule's map and template; the template wins over render; empty render output warns; successful rules report none.
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
    const render = vi.fn(() => '# template');
    const templateEngine = {
      hbs: undefined,
      render,
    } as unknown as TemplateEngine;
    const result = await applyRules(
      compileRules([
        rule({
          schema: [
            {
              type: 'object',
              properties: { t: { type: 'string', set: '{{noSuchHelper x}}' } },
            },
          ],
          map: { mapped: 'yes' },
          template: 't',
        }),
      ]),
      attributes,
      { logger, templateEngine },
    );
    expect(result.matchedRules).toEqual(['r']);
    expect(result.errors).toEqual([
      { rule: 'r', stage: 'schema', message: expect.any(String) as unknown },
    ]);
    // Neither the map nor the template ran.
    expect(result.metadata).toEqual({});
    expect(render).not.toHaveBeenCalled();
    expect(result.renderedContent).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('applies the map and template of a rule whose schema succeeds', async () => {
    const render = vi.fn(() => '# template');
    const templateEngine = {
      hbs: undefined,
      render,
    } as unknown as TemplateEngine;
    const result = await applyRules(
      compileRules([rule({ map: { mapped: 'yes' }, template: 't' })]),
      attributes,
      { logger: { warn: vi.fn() }, templateEngine },
    );
    expect(result.metadata).toEqual({ mapped: 'yes' });
    expect(result.renderedContent).toBe('# template');
  });

  it('reports a failing render (stage render) and falls back to raw content', async () => {
    const logger = { warn: vi.fn() };
    const result = await applyRules(
      compileRules([
        rule({
          render: {
            frontmatter: [],
            body: [{ path: 'title', heading: 1, format: 'noSuchHelper' }],
          },
        }),
      ]),
      attributes,
      { logger },
    );
    expect(result.renderedContent).toBeNull();
    expect(result.errors).toEqual([
      {
        rule: 'r',
        stage: 'render',
        message: 'Format helper not found: noSuchHelper',
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^renderDoc failed for rule "r"/),
    );
  });

  it('uses the template output over the render output when both render', async () => {
    const templateEngine = {
      hbs: undefined,
      render: () => '# template',
    } as unknown as TemplateEngine;
    const result = await applyRules(
      compileRules([
        rule({
          render: { frontmatter: [], body: [{ path: 'title', heading: 1 }] },
          template: 't',
        }),
      ]),
      attributes,
      { logger: { warn: vi.fn() }, templateEngine },
    );
    expect(result.renderedContent).toBe('# template');
    expect(result.errors).toEqual([]);
  });

  it('keeps the render output when the template fails', async () => {
    const templateEngine = {
      hbs: undefined,
      render: () => {
        throw new Error('boom');
      },
    } as unknown as TemplateEngine;
    const result = await applyRules(
      compileRules([
        rule({
          render: { frontmatter: [], body: [{ path: 'title', heading: 1 }] },
          template: 't',
        }),
      ]),
      attributes,
      { logger: { warn: vi.fn() }, templateEngine },
    );
    expect(result.renderedContent).toBe('# Title\n\nT\n');
    expect(result.errors).toEqual([
      { rule: 'r', stage: 'template', message: 'boom' },
    ]);
  });

  it('warns and keeps raw content when the render output is empty', async () => {
    const logger = { warn: vi.fn() };
    const result = await applyRules(
      compileRules([rule({ render: { frontmatter: [], body: [] } })]),
      attributes,
      { logger },
    );
    expect(result.renderedContent).toBeNull();
    expect(result.errors).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'renderDoc for rule "r" rendered empty output. Falling back to raw content.',
    );
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
