/**
 * @module config/assertResolvedSecrets.test
 * Tests for the startup secret checks (unresolved env references in api.apiKey and sources, empty api.apiKey) and the load-time warnings (unknown source keys, reserved rule field names), unit and through loadConfig.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertResolvedSecrets,
  findUnresolvedSecrets,
} from './assertResolvedSecrets';
import { loadConfig } from './loadConfig';
import type { JeevesWatcherConfig } from './types';

const base = {
  watch: { paths: ['**/*.md'] },
  embedding: {},
  vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
};

const asConfig = (extra: Record<string, unknown>) =>
  ({ ...base, ...extra }) as unknown as JeevesWatcherConfig;

const ref = (name: string) => '$' + `{${name}}`;

describe('findUnresolvedSecrets', () => {
  it('returns nothing for a config without secrets', () => {
    expect(findUnresolvedSecrets(asConfig({}))).toEqual([]);
  });

  it('returns nothing when values are resolved', () => {
    const config = asConfig({
      api: { apiKey: 'k' },
      sources: {
        app: { url: 'http://x/{id}', headers: { Authorization: 'Bearer t' } },
      },
    });
    expect(findUnresolvedSecrets(config)).toEqual([]);
  });

  it('reports every offending path', () => {
    const config = asConfig({
      api: { apiKey: ref('WATCHER_KEY') },
      sources: {
        app: {
          url: `${ref('BASE')}/{id}`,
          headers: { Authorization: `Bearer ${ref('APP_KEY')}`, X: 'ok' },
        },
      },
    });
    expect(findUnresolvedSecrets(config)).toEqual([
      'api.apiKey',
      'sources.app.url',
      'sources.app.headers.Authorization',
    ]);
  });
});

describe('assertResolvedSecrets', () => {
  it('does not throw when everything is resolved', () => {
    expect(() => {
      assertResolvedSecrets(asConfig({ api: { apiKey: 'k' } }));
    }).not.toThrow();
  });

  it('throws naming the path but not the value', () => {
    const config = asConfig({ api: { apiKey: `pre-${ref('SECRET_X')}` } });
    expect(() => {
      assertResolvedSecrets(config);
    }).toThrow(/api\.apiKey/);
    expect(() => {
      assertResolvedSecrets(config);
    }).not.toThrow(/pre-/);
    // Not even the referenced variable's name.
    expect(() => {
      assertResolvedSecrets(config);
    }).not.toThrow(/SECRET_X/);
  });
});

describe('loadConfig secret check', () => {
  const envName = 'JW_TEST_SECRET_CHECK_KEY';

  const dirs: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  const writeConfig = async (config: Record<string, unknown>) => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-secret-'));
    dirs.push(dir);
    const cfgPath = join(dir, 'jeeves-watcher.config.json');
    await writeFile(cfgPath, JSON.stringify(config), 'utf8');
    return cfgPath;
  };

  it('fails when api.apiKey references an unset variable', async () => {
    const cfgPath = await writeConfig({
      ...base,
      api: { apiKey: ref(envName) },
    });
    await expect(loadConfig(cfgPath)).rejects.toThrow(/api\.apiKey/);
  });

  it('fails when a source header references an unset variable', async () => {
    const cfgPath = await writeConfig({
      ...base,
      sources: {
        app: {
          url: 'http://x/{id}',
          headers: { Authorization: `Bearer ${ref(envName)}` },
        },
      },
    });
    await expect(loadConfig(cfgPath)).rejects.toThrow(
      /sources\.app\.headers\.Authorization/,
    );
  });

  it('loads when the variable is set', async () => {
    vi.stubEnv(envName, 'resolved-key');
    const cfgPath = await writeConfig({
      ...base,
      api: { apiKey: ref(envName) },
    });
    const config = await loadConfig(cfgPath);
    expect(config.api?.apiKey).toBe('resolved-key');
  });

  it('fails with a clear message when api.apiKey resolves to an empty string', async () => {
    vi.stubEnv(envName, '');
    const cfgPath = await writeConfig({
      ...base,
      api: { apiKey: ref(envName) },
    });
    await expect(loadConfig(cfgPath)).rejects.toThrow(
      /api\.apiKey is empty after environment variable substitution/,
    );
  });

  it('fails at validation when api.apiKey is written empty', async () => {
    const cfgPath = await writeConfig({ ...base, api: { apiKey: '' } });
    await expect(loadConfig(cfgPath)).rejects.toThrow(
      /api\.apiKey: api\.apiKey must be a non-empty string/,
    );
  });

  it('reports unknown source keys through onWarning', async () => {
    const cfgPath = await writeConfig({
      ...base,
      sources: { app: { url: 'http://x/{id}', batchUrl: 'http://x/b' } },
    });
    const onWarning = vi.fn();
    const config = await loadConfig(cfgPath, { onWarning });
    expect(onWarning).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: 'sources.app.batchUrl' }),
    );
    expect(config.sources?.['app']).not.toHaveProperty('batchUrl');
  });

  it('reports reserved rule field names through onWarning (after source keys)', async () => {
    const cfgPath = await writeConfig({
      ...base,
      sources: { app: { url: 'http://x/{id}', batchUrl: 'http://x/b' } },
      inferenceRules: [
        {
          name: 'r',
          description: 'r',
          match: { type: 'object' },
          schema: [{ type: 'object', properties: { file_path: {} } }],
        },
      ],
    });
    const onWarning = vi.fn();
    await loadConfig(cfgPath, { onWarning });
    expect(
      onWarning.mock.calls.map(([w]) => (w as { path: string }).path),
    ).toEqual(['sources.app.batchUrl', 'inferenceRules[r].schema.file_path']);
  });
});
