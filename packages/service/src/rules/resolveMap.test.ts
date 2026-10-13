/**
 * @module rules/resolveMap.test
 * resolveMapDefinition: inline maps pass through, `.json` maps load relative to the config directory, unreadable or unparsable map files and unknown named maps warn and yield undefined (temp files).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { resolveMapDefinition } from './resolveMap';

describe('resolveMapDefinition', () => {
  let configDir: string;

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'jw-maps-'));
    await writeFile(join(configDir, 'map.json'), '{"title":"x"}');
    await writeFile(join(configDir, 'broken.json'), '{not json');
  });

  afterAll(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it('returns an inline map unchanged', () => {
    const map = { title: 'x' };
    const log = { warn: vi.fn() };
    expect(resolveMapDefinition(map, undefined, configDir, log)).toBe(map);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('loads a .json map relative to the config directory', () => {
    const log = { warn: vi.fn() };
    expect(resolveMapDefinition('map.json', {}, configDir, log)).toEqual({
      title: 'x',
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['missing.json', /^Failed to load map file "missing\.json": .*ENOENT/],
    ['broken.json', /^Failed to load map file "broken\.json": .*JSON/],
  ])('warns and skips an unusable map file %s', (file, message) => {
    const log = { warn: vi.fn() };
    expect(resolveMapDefinition(file, {}, configDir, log)).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(message));
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping the rule's map, render and template."),
    );
  });

  it('resolves a named map, and warns for an unknown one', () => {
    const named = { title: 'n' };
    const log = { warn: vi.fn() };
    expect(resolveMapDefinition('m', { m: named }, configDir, log)).toBe(named);
    expect(log.warn).not.toHaveBeenCalled();
    expect(resolveMapDefinition('nope', { m: named }, configDir, log)).toBe(
      undefined,
    );
    expect(log.warn).toHaveBeenCalledWith(
      `Map reference "nope" not found in named maps. Skipping the rule's map, render and template.`,
    );
  });
});
