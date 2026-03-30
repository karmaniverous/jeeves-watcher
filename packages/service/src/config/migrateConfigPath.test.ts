/**
 * @module config/migrateConfigPath.test
 *
 * Tests for config path migration from flat to namespaced convention.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { migrateConfigPath } from './migrateConfigPath';

const SAMPLE_CONFIG = JSON.stringify({ watch: { paths: ['**/*.md'] } });

describe('migrateConfigPath', () => {
  it('migrates old path to new path when only old exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-migrate-'));
    await writeFile(
      join(dir, 'jeeves-watcher.config.json'),
      SAMPLE_CONFIG,
      'utf8',
    );

    const result = migrateConfigPath(dir);

    expect(result.migrated).toBe(true);
    expect(result.configPath).toBe(join(dir, 'jeeves-watcher', 'config.json'));
    expect(result.warning).toBeUndefined();

    // Old file should no longer exist
    expect(existsSync(join(dir, 'jeeves-watcher.config.json'))).toBe(false);

    // New file should contain the same content
    const content = readFileSync(result.configPath, 'utf8');
    expect(content).toBe(SAMPLE_CONFIG);
  });

  it('uses new path when only new path exists (no migration)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-migrate-'));
    const newDir = join(dir, 'jeeves-watcher');
    await mkdir(newDir, { recursive: true });
    await writeFile(join(newDir, 'config.json'), SAMPLE_CONFIG, 'utf8');

    const result = migrateConfigPath(dir);

    expect(result.migrated).toBe(false);
    expect(result.configPath).toBe(join(newDir, 'config.json'));
    expect(result.warning).toBeUndefined();
  });

  it('prefers new path and warns when both exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-migrate-'));

    // Create old file
    await writeFile(
      join(dir, 'jeeves-watcher.config.json'),
      SAMPLE_CONFIG,
      'utf8',
    );

    // Create new file
    const newDir = join(dir, 'jeeves-watcher');
    await mkdir(newDir, { recursive: true });
    await writeFile(join(newDir, 'config.json'), SAMPLE_CONFIG, 'utf8');

    const result = migrateConfigPath(dir);

    expect(result.migrated).toBe(false);
    expect(result.configPath).toBe(join(newDir, 'config.json'));
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('legacy');
  });

  it('throws when neither old nor new config exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-migrate-'));

    expect(() => migrateConfigPath(dir)).toThrow(
      /No jeeves-watcher configuration found/,
    );
  });

  it('is idempotent — second call after migration is a no-op', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-migrate-'));
    await writeFile(
      join(dir, 'jeeves-watcher.config.json'),
      SAMPLE_CONFIG,
      'utf8',
    );

    // First call migrates
    const first = migrateConfigPath(dir);
    expect(first.migrated).toBe(true);

    // Second call finds new path, no migration
    const second = migrateConfigPath(dir);
    expect(second.migrated).toBe(false);
    expect(second.configPath).toBe(first.configPath);
  });
});
