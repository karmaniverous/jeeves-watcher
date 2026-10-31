/**
 * @module scripts/generate-skill
 * Writes `src/skill.generated.ts` from `skills/jeeves-watcher/SKILL.md`, formatted with the repo's Prettier config. Run with `npm run skill` after editing the skill; the drift test fails until you do.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { format, resolveConfig } from 'prettier';

import { renderSkillModule, SKILL_MODULE, SKILL_SOURCE } from './skillModule';

const source = renderSkillModule(readFileSync(SKILL_SOURCE, 'utf8'));
const options = (await resolveConfig(SKILL_MODULE)) ?? {};
writeFileSync(
  SKILL_MODULE,
  await format(source, { ...options, filepath: SKILL_MODULE }),
  'utf8',
);
console.log(`Wrote ${SKILL_MODULE}`);
