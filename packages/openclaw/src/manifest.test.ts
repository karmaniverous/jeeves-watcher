/**
 * @module plugin/manifest.test
 * Static checks on the published plugin manifest, package.json, and skill.
 */

import { readFileSync } from 'node:fs';

import { validateSkillFrontmatter } from '@karmaniverous/jeeves';
import { describe, expect, it } from 'vitest';

const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;

interface Manifest {
  skills: string[];
  configSchema: {
    additionalProperties: boolean;
    required?: string[];
    properties: Record<string, { type: string; default?: unknown }>;
  };
  uiHints: Record<string, { placeholder?: string; sensitive?: boolean }>;
}

const manifest = readJson('../openclaw.plugin.json') as unknown as Manifest;

describe('openclaw.plugin.json', () => {
  const { properties } = manifest.configSchema;

  it('declares configRoot with no default and does not require it', () => {
    expect(properties.configRoot.type).toBe('string');
    expect(properties.configRoot).not.toHaveProperty('default');
    expect(manifest.configSchema.required ?? []).not.toContain('configRoot');
  });

  it('declares apiUrl and rejects unknown keys', () => {
    expect(properties.apiUrl.type).toBe('string');
    expect(manifest.configSchema.additionalProperties).toBe(false);
  });

  it('declares an optional, sensitive apiKey with no default', () => {
    expect(properties.apiKey.type).toBe('string');
    expect(properties.apiKey).not.toHaveProperty('default');
    expect(manifest.configSchema.required ?? []).not.toContain('apiKey');
    expect(manifest.uiHints.apiKey.sensitive).toBe(true);
  });

  it('carries no Windows drive-letter paths', () => {
    expect(JSON.stringify(manifest)).not.toMatch(/"[a-zA-Z]:[\\/]/);
  });

  it('ships the skill from dist', () => {
    expect(manifest.skills).toEqual(['dist/skills/jeeves-watcher']);
  });
});

describe('package.json', () => {
  const pkg = readJson('../package.json');

  it('exposes no plugin installer CLI', () => {
    expect(pkg).not.toHaveProperty('bin');
  });

  it('pins the static-content jeeves core (exact, 0.6 or later)', () => {
    const deps = pkg.dependencies as Record<string, string>;
    const pin = deps['@karmaniverous/jeeves'];
    expect(pin).toMatch(/^0\.\d+\.\d+$/);
    expect(Number(pin.split('.')[1])).toBeGreaterThanOrEqual(6);
  });
});

describe('skills/jeeves-watcher/SKILL.md', () => {
  it('has name and description frontmatter', () => {
    const skill = readFileSync(
      new URL('../skills/jeeves-watcher/SKILL.md', import.meta.url),
      'utf8',
    );
    expect(validateSkillFrontmatter(skill).name).toBe('jeeves-watcher');
  });
});
