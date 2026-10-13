/**
 * @module app/configReload.sources.test
 * A config-reload-triggered `rules` reindex stays file-only (Decision 16.11): reloadConfig never asks executeReindex to include source documents.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { executeReindex } from '../api/executeReindex';
import type { JeevesWatcherConfig } from '../config/types';
import type { DocumentProcessorInterface } from '../processor';
import { reloadConfig } from './configReload';
import type { JeevesWatcherFactories } from './factories';

vi.mock('./initialization', async () => {
  const actual: Record<string, unknown> =
    await vi.importActual('./initialization');
  return {
    ...actual,
    buildTemplateEngineAndCustomMapLib: vi.fn().mockResolvedValue({
      templateEngine: undefined,
      customMapLib: undefined,
    }),
  };
});

vi.mock('../api/executeReindex', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  executeReindex: vi.fn().mockResolvedValue(undefined),
}));

describe('reloadConfig: source documents', () => {
  it('triggers a file-only rules reindex', async () => {
    const config = {
      watch: { paths: ['**/*.md'], respectGitignore: false },
      embedding: { provider: 'mock', model: 'test' },
      vectorStore: { url: 'http://localhost', collectionName: 'test' },
      inferenceRules: [],
      configWatch: { reindex: 'rules' },
    } as unknown as JeevesWatcherConfig;
    const factories = {
      loadConfig: vi.fn().mockResolvedValue(config),
      compileRules: vi.fn().mockReturnValue([]),
    } as unknown as JeevesWatcherFactories;
    const processor = {
      updateRules: vi.fn(),
    } as unknown as DocumentProcessorInterface;

    await reloadConfig(
      { config, watcher: { start: vi.fn(), stop: vi.fn() } as never },
      {
        configPath: '/path/to/config.json',
        factories,
        queue: {} as never,
        processor,
        logger: pino({ level: 'silent' }),
        runtimeOptions: {},
        initialScanTracker: {} as never,
      },
    );

    const mocked = vi.mocked(executeReindex);
    expect(mocked).toHaveBeenCalledOnce();
    const [deps, options] = mocked.mock.calls[0];
    expect(options).toEqual({ scope: 'rules' });
    expect(deps.config).toBe(config);
    // A files-only reindex: nothing that would reach source documents.
    expect(deps).not.toHaveProperty('includeSources');
    expect(deps.vectorStore).toBeUndefined();
    expect(deps.sourceQueue).toBeUndefined();
    expect(deps.queue).toBeUndefined();
  });
});
