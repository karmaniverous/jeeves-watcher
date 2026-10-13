/**
 * @module cli/jeeves-watcher/apiClient.configKey.test
 * The CLI never takes its API key from the config file: with a discoverable config carrying `api.apiKey` in the working directory and neither `--api-key` nor JEEVES_WATCHER_API_KEY set, requests carry no Authorization header and loadConfig is never called. Temp dir + chdir; fetch stubbed.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from '@commander-js/extra-typings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../../config/loadConfig';
import { API_KEY_ENV_VAR } from './apiClient';
import { registerCustomCommands } from './customCommands';

vi.mock('../../config/loadConfig', async (importOriginal) => {
  const actual = await importOriginal<{ loadConfig: typeof loadConfig }>();
  return { ...actual, loadConfig: vi.fn(actual.loadConfig) };
});

const CONFIG_KEY = 'config-file-key-must-not-be-sent';

type FetchArgs = [string, RequestInit | undefined];

const fetchMock = vi.fn<(...args: FetchArgs) => Promise<unknown>>();

describe('CLI API key source', () => {
  const cwd = process.cwd();
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jw-cli-key-'));
    const config = {
      watch: { paths: ['**/*.md'] },
      embedding: { provider: 'mock', model: 'm' },
      vectorStore: { url: 'http://127.0.0.1:6333', collectionName: 'c' },
      api: { apiKey: CONFIG_KEY },
    };
    // Both the legacy flat file and the rc file cosmiconfig discovers.
    await writeFile(
      join(dir, 'jeeves-watcher.config.json'),
      JSON.stringify(config),
    );
    await writeFile(join(dir, '.jeeves-watcherrc'), JSON.stringify(config));
    process.chdir(dir);

    vi.stubEnv(API_KEY_ENV_VAR, undefined);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}'),
      json: () => Promise.resolve({}),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(cwd);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.mocked(loadConfig).mockClear();
    process.exitCode = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('ignores api.apiKey in a config file when neither flag nor env is set', async () => {
    // The fixture is a real, loadable config carrying the key.
    await expect(
      vi.mocked(loadConfig).getMockImplementation()!(),
    ).resolves.toMatchObject({ api: { apiKey: CONFIG_KEY } });
    vi.mocked(loadConfig).mockClear();

    const cli = new Command().exitOverride();
    registerCustomCommands(cli);
    await cli.parseAsync(['node', 'test', 'issues']);

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(CONFIG_KEY);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});
