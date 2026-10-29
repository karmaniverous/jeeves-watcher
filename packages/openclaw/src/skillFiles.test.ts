import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SKILL_DIR, writeSkill } from './skillFiles.js';

const manifest = JSON.parse(
  readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'),
) as { skills: string[] };

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('writeSkill', () => {
  it('writes the skill verbatim to <dist>/skills/jeeves-watcher/SKILL.md', () => {
    dir = mkdtempSync(join(tmpdir(), 'watcher-skill-'));
    const file = writeSkill(dir, '---\nname: x\n---\n# X\n');
    expect(file).toBe(join(dir, 'skills', 'jeeves-watcher', 'SKILL.md'));
    expect(readFileSync(file, 'utf8')).toBe('---\nname: x\n---\n# X\n');
  });

  it('targets the folder the manifest lists', () => {
    expect(manifest.skills).toEqual([`dist/${SKILL_DIR}`]);
  });
});
