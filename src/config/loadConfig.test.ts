/**
 * @module config/loadConfig.test
 *
 * Tests for config loading, validation, and edge cases.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig } from './loadConfig';
import { jeevesWatcherConfigSchema } from './schemas';

const minimalValidConfig = {
  watch: { paths: ['**/*.md'] },
  embedding: {},
  vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
};

describe('loadConfig', () => {
  it('should be importable', () => {
    expect(loadConfig).toBeDefined();
  });

  it('throws when loading a non-existent config path', async () => {
    await expect(loadConfig('/no/such/file.json')).rejects.toThrow();
  });

  it('throws for config with missing required fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-cfg-'));
    const cfgPath = join(dir, 'jeeves-watcher.config.json');
    await writeFile(cfgPath, JSON.stringify({}), 'utf8');

    await expect(loadConfig(cfgPath)).rejects.toThrow(
      /Invalid jeeves-watcher configuration/,
    );
  });

  it('throws for config with invalid types', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-cfg-'));
    const cfgPath = join(dir, 'jeeves-watcher.config.json');
    await writeFile(
      cfgPath,
      JSON.stringify({
        watch: { paths: 'not-an-array' },
        embedding: {},
        vectorStore: { url: 123, collectionName: true },
      }),
      'utf8',
    );

    await expect(loadConfig(cfgPath)).rejects.toThrow(
      /Invalid jeeves-watcher configuration/,
    );
  });

  it('loads a valid config and applies defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-cfg-'));
    const cfgPath = join(dir, 'jeeves-watcher.config.json');
    await writeFile(cfgPath, JSON.stringify(minimalValidConfig), 'utf8');

    const config = await loadConfig(cfgPath);
    expect(config.watch.paths).toEqual(['**/*.md']);
    // Defaults should be applied
    expect(config.api?.host).toBe('127.0.0.1');
    expect(config.api?.port).toBe(3456);
    expect(config.logging?.level).toBe('info');
  });

  it('substitutes ${ENV_VAR} in config string values', async () => {
    const envKey = 'JW_TEST_CONFIG_API_KEY';
    process.env[envKey] = 'secret-key-123';

    try {
      const dir = await mkdtemp(join(tmpdir(), 'jw-cfg-'));
      const cfgPath = join(dir, 'jeeves-watcher.config.json');
      await writeFile(
        cfgPath,
        JSON.stringify({
          ...minimalValidConfig,
          embedding: { apiKey: `\${${envKey}}` },
        }),
        'utf8',
      );

      const config = await loadConfig(cfgPath);
      expect(config.embedding.apiKey).toBe('secret-key-123');
    } finally {
      process.env[envKey] = undefined;
    }
  });

  it('throws for missing env var in config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-cfg-'));
    const cfgPath = join(dir, 'jeeves-watcher.config.json');
    await writeFile(
      cfgPath,
      JSON.stringify({
        ...minimalValidConfig,
        embedding: { apiKey: '${MISSING_JW_VAR_99}' },
      }),
      'utf8',
    );

    await expect(loadConfig(cfgPath)).rejects.toThrow(/MISSING_JW_VAR_99/);
  });
});

describe('jeevesWatcherConfigSchema', () => {
  it('rejects config with missing required fields', () => {
    const result = jeevesWatcherConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects watch.paths as non-array', () => {
    const result = jeevesWatcherConfigSchema.safeParse({
      watch: { paths: 'not-an-array' },
      embedding: {},
      vectorStore: { url: 'http://x', collectionName: 'c' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects watch.paths as empty array', () => {
    const result = jeevesWatcherConfigSchema.safeParse({
      watch: { paths: [] },
      embedding: {},
      vectorStore: { url: 'http://x', collectionName: 'c' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts minimal valid config and applies schema defaults', () => {
    const result = jeevesWatcherConfigSchema.safeParse(minimalValidConfig);
    expect(result.success).toBe(true);
    expect(result.data?.embedding.provider).toBe('gemini');
    expect(result.data?.embedding.model).toBe('gemini-embedding-001');
  });

  it('strips unknown top-level fields', () => {
    const result = jeevesWatcherConfigSchema.safeParse({
      ...minimalValidConfig,
      completelyUnknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    expect(
      (result.data as Record<string, unknown>)['completelyUnknownField'],
    ).toBeUndefined();
  });

  it('rejects invalid types in nested config', () => {
    const result = jeevesWatcherConfigSchema.safeParse({
      watch: { paths: ['*.md'] },
      embedding: { chunkSize: 'not-a-number' },
      vectorStore: { url: 'http://x', collectionName: 'c' },
    });
    expect(result.success).toBe(false);
    const pathStrs = result.error?.issues.map((i) => i.path.join('.'));
    expect(pathStrs).toContain('embedding.chunkSize');
  });

  it('validates inference rules structure', () => {
    const result = jeevesWatcherConfigSchema.safeParse({
      ...minimalValidConfig,
      inferenceRules: [{ match: { type: 'object' }, set: { a: 1 } }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects inference rules missing required set field', () => {
    const result = jeevesWatcherConfigSchema.safeParse({
      ...minimalValidConfig,
      inferenceRules: [{ match: { type: 'object' } }],
    });
    expect(result.success).toBe(false);
  });
});
