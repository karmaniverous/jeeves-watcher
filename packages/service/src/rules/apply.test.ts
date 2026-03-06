import { describe, expect, it } from 'vitest';

import { applyRules } from './apply';
import type { CompiledRule } from './compile';

/** Create a minimal CompiledRule that always matches. */
function makeRule(name: string, renderAs?: string): CompiledRule {
  return {
    rule: { name, renderAs } as CompiledRule['rule'],
    validate: () => true,
  };
}

/** Create a minimal CompiledRule that never matches. */
function makeNonMatchingRule(name: string, renderAs?: string): CompiledRule {
  return {
    rule: { name, renderAs } as CompiledRule['rule'],
    validate: () => false,
  };
}

const mockAttrs = {
  file: {
    path: '/test/file.md',
    extension: '.md',
    filename: 'file.md',
    directory: '/test',
    sizeBytes: 0,
    modified: '',
  },
};

describe('applyRules renderAs', () => {
  it('returns renderAs from a matching rule', async () => {
    const result = await applyRules([makeRule('r1', 'md')], mockAttrs);
    expect(result.renderAs).toBe('md');
  });

  it('returns null when no rule declares renderAs', async () => {
    const result = await applyRules([makeRule('r1')], mockAttrs);
    expect(result.renderAs).toBeNull();
  });

  it('last-match-wins when multiple rules declare renderAs', async () => {
    const result = await applyRules(
      [makeRule('r1', 'md'), makeRule('r2', 'html')],
      mockAttrs,
    );
    expect(result.renderAs).toBe('html');
  });

  it('uses last matching rule with renderAs (skips rules without it)', async () => {
    const result = await applyRules(
      [makeRule('r1', 'md'), makeRule('r2')],
      mockAttrs,
    );
    expect(result.renderAs).toBe('md');
  });

  it('ignores renderAs from non-matching rules', async () => {
    const result = await applyRules(
      [makeNonMatchingRule('r1', 'md'), makeRule('r2')],
      mockAttrs,
    );
    expect(result.renderAs).toBeNull();
  });
});
