/**
 * @module api/mcp/mcpContent.test
 * The skill preface goes after the skill's front matter, or first when there is none.
 */

import { describe, expect, it } from 'vitest';

import { withSkillPreface } from './mcpContent';

const options = {
  skillUri: 'skill://x/SKILL.md',
  toolCount: 3,
};

describe('withSkillPreface', () => {
  it('inserts the preface after the front matter, keeping it first', () => {
    const skill = '---\nname: x\n---\n# Body\n';
    const result = withSkillPreface(skill, options);

    expect(result.startsWith('---\nname: x\n---\n')).toBe(true);
    expect(result.indexOf('Using this skill over MCP')).toBeLessThan(
      result.indexOf('# Body'),
    );
    expect(result).toContain('(3 of them)');
    expect(result).toContain('`/mcp`');
  });

  it('puts the preface first when the skill has no front matter', () => {
    const result = withSkillPreface('# Body\n', options);

    expect(
      result.trimStart().startsWith('> **Using this skill over MCP.**'),
    ).toBe(true);
    expect(result.endsWith('# Body\n')).toBe(true);
  });
});
