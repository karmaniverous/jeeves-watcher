import { readFileSync } from 'node:fs';

import { validateSkillFrontmatter } from '@karmaniverous/jeeves';
import { describe, expect, it } from 'vitest';

import { normaliseSkill, SKILL_SOURCE } from '../scripts/skillModule';
import { WATCHER_SKILL } from './skill.generated';

/**
 * OpenClaw cuts every catalog description to a compact form once the full
 * skills catalog exceeds `skills.limits.maxSkillsPromptChars`, so the
 * description stays short: trigger words, no filler.
 */
const MAX_DESCRIPTION_CHARS = 160;

describe('WATCHER_SKILL', () => {
  it('matches skills/jeeves-watcher/SKILL.md (run `npm run skill` after editing it)', () => {
    expect(WATCHER_SKILL).toBe(
      normaliseSkill(readFileSync(SKILL_SOURCE, 'utf8')),
    );
  });

  it('has name and description frontmatter', () => {
    expect(validateSkillFrontmatter(WATCHER_SKILL).name).toBe('jeeves-watcher');
  });

  it(`keeps its description within ${String(MAX_DESCRIPTION_CHARS)} characters`, () => {
    expect(
      validateSkillFrontmatter(WATCHER_SKILL).description.length,
    ).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
  });
});

describe('normaliseSkill', () => {
  it('turns CRLF into LF', () => {
    expect(normaliseSkill('a\r\nb\n')).toBe('a\nb\n');
  });
});
