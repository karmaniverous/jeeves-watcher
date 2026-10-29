/**
 * @module scripts/skillModule
 * Paths and source text for the generated skill module (`src/skill.generated.ts`) compiled from `skills/jeeves-watcher/SKILL.md`. Pure; the writer is `generate-skill.ts`.
 */

import { fileURLToPath } from 'node:url';

/** The skill markdown (source of truth). */
export const SKILL_SOURCE = fileURLToPath(
  new URL('../skills/jeeves-watcher/SKILL.md', import.meta.url),
);

/** The generated module exporting `WATCHER_SKILL`. */
export const SKILL_MODULE = fileURLToPath(
  new URL('../src/skill.generated.ts', import.meta.url),
);

/**
 * Normalise markdown to LF line endings, so the compiled string is the same
 * on every platform.
 *
 * @param markdown - Raw `SKILL.md` contents.
 * @returns The LF-normalised text.
 */
export function normaliseSkill(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n');
}

/**
 * TypeScript source of the generated module (formatted later by Prettier).
 *
 * @param markdown - Raw `SKILL.md` contents.
 * @returns Module source exporting `WATCHER_SKILL`.
 */
export function renderSkillModule(markdown: string): string {
  return [
    '/**',
    ' * @module skill.generated',
    ' * The jeeves-watcher skill (descriptor `skill`), compiled from `skills/jeeves-watcher/SKILL.md` by `npm run skill`. Generated; do not edit.',
    ' */',
    '',
    '/** Contents of the jeeves-watcher `SKILL.md`. */',
    `export const WATCHER_SKILL = ${JSON.stringify(normaliseSkill(markdown))};`,
    '',
  ].join('\n');
}
