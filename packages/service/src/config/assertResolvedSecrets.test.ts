/**
 * @module config/assertResolvedSecrets.test
 * Tests for the unresolved-`${…}` startup check on api.apiKey and sources, unit and through loadConfig.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
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
  });
});

describe('loadConfig secret check', () => {
  const envName = 'JW_TEST_SECRET_CHECK_KEY';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const writeConfig = async (config: Record<string, unknown>) => {
    const dir = await mkdtemp(join(tmpdir(), 'jw-secret-'));
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
});
