/**
 * @module config/schemas/inference.test
 * Tests for inference schema validation.
 */

import { describe, expect, it } from 'vitest';

import { inferenceRuleSchema } from './inference';

describe('inferenceRuleSchema', () => {
  const baseRule = {
    name: 'test-rule',
    description: 'A test rule',
    match: { type: 'object' },
  };

  it('accepts rule with render and no template', () => {
    const result = inferenceRuleSchema.safeParse({
      ...baseRule,
      render: { frontmatter: ['key'], body: [] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts rule with template and no render', () => {
    const result = inferenceRuleSchema.safeParse({
      ...baseRule,
      template: 'some-template',
    });
    expect(result.success).toBe(true);
  });

  it('rejects rule with both render and template', () => {
    const result = inferenceRuleSchema.safeParse({
      ...baseRule,
      template: 'some-template',
      render: { frontmatter: ['key'], body: [] },
    });
    expect(result.success).toBe(false);
    const issues = (
      result as {
        success: false;
        error: { issues: Array<{ message: string }> };
      }
    ).error.issues;
    expect(issues[0].message).toContain('mutually exclusive');
  });

  it('accepts rule with neither render nor template', () => {
    const result = inferenceRuleSchema.safeParse(baseRule);
    expect(result.success).toBe(true);
  });

  describe('renderAs', () => {
    it('accepts renderAs with render present', () => {
      const result = inferenceRuleSchema.safeParse({
        ...baseRule,
        render: { frontmatter: ['key'], body: [] },
        renderAs: 'html',
      });
      expect(result.success).toBe(true);
    });

    it('accepts renderAs with template present', () => {
      const result = inferenceRuleSchema.safeParse({
        ...baseRule,
        template: 'some-template',
        renderAs: 'md',
      });
      expect(result.success).toBe(true);
    });

    it('rejects renderAs without template or render', () => {
      const result = inferenceRuleSchema.safeParse({
        ...baseRule,
        renderAs: 'md',
      });
      expect(result.success).toBe(false);
      const issues = (
        result as {
          success: false;
          error: { issues: Array<{ message: string }> };
        }
      ).error.issues;
      expect(issues[0].message).toContain(
        'renderAs requires template or render',
      );
    });

    it('rejects renderAs with invalid format', () => {
      const cases = ['HTML', 'toolongextension', '.md', 'a b'];
      for (const renderAs of cases) {
        const result = inferenceRuleSchema.safeParse({
          ...baseRule,
          template: 'some-template',
          renderAs,
        });
        expect(result.success, `expected "${renderAs}" to be rejected`).toBe(
          false,
        );
      }
    });

    it('accepts rule without renderAs', () => {
      const result = inferenceRuleSchema.safeParse({
        ...baseRule,
        template: 'some-template',
      });
      expect(result.success).toBe(true);
    });
  });
});
