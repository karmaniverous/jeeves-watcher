import { readFileSync } from 'node:fs';

import { validateSkillFrontmatter } from '@karmaniverous/jeeves';
import { describe, expect, it } from 'vitest';

import { normaliseSkill, SKILL_SOURCE } from '../scripts/skillModule';
import { WATCHER_SKILL } from './skill.generated';

describe('WATCHER_SKILL', () => {
  it('matches skills/jeeves-watcher/SKILL.md (run `npm run skill` after editing it)', () => {
    expect(WATCHER_SKILL).toBe(
      normaliseSkill(readFileSync(SKILL_SOURCE, 'utf8')),
    );
  });

  it('has name and description frontmatter', () => {
    expect(validateSkillFrontmatter(WATCHER_SKILL).name).toBe('jeeves-watcher');
  });
});

describe('normaliseSkill', () => {
  it('turns CRLF into LF', () => {
    expect(normaliseSkill('a\r\nb\n')).toBe('a\nb\n');
  });
});
