/**
 * @module app/startup.facetWarnings.test
 * App wiring for D206 (3), (4): the start and a config reload log the configured rules' unknown uiHints and, through the vector store's facet store, their facet fields with no payload index.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InferenceRule, JeevesWatcherConfig } from '../config/types';
import { createTestConfig } from '../test/helpers';
import type { JeevesWatcherFactories } from './factories';
import { JeevesWatcher } from './index';

/** The config watcher's change callback, captured per start. */
const onChanges = vi.hoisted(() => [] as (() => void | Promise<void>)[]);

vi.mock('./configWatcher', () => ({
  ConfigWatcher: class {
    constructor(options: { onChange: () => void | Promise<void> }) {
      onChanges.push(options.onChange);
    }
    start(): void {
      // Nothing to watch: the test calls onChange.
    }
    stop(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

/** Factories whose vector store reads `payloadIndexTypes` as the payload indexes. */
function buildFactories(
  logger: pino.Logger,
  payloadIndexTypes: () => Promise<Record<string, string>>,
): Partial<JeevesWatcherFactories> {
  return {
    createLogger: () => Promise.resolve(logger),
    createVectorStoreClient: () =>
      ({
        ensureCollection: vi.fn().mockResolvedValue(undefined),
        ensureTextIndex: vi.fn().mockResolvedValue(undefined),
        facets: { payloadIndexTypes },
      }) as never,
    createDocumentProcessor: () =>
      ({ sourceOperations: () => ({}), updateRules: vi.fn() }) as never,
    createFileSystemWatcher: () =>
      ({
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
      }) as never,
    createApiServer: () =>
      ({
        listen: vi.fn().mockResolvedValue(''),
        close: vi.fn().mockResolvedValue(undefined),
      }) as never,
  };
}

/** Rule `r`: an unknown hint on `odd`, an indexed facet field `tag`. */
const RULE: InferenceRule = {
  name: 'r',
  description: 'r',
  match: {},
  schema: [
    {
      properties: {
        odd: { type: 'string', uiHint: 'selct' },
        tag: { type: 'string', uiHint: 'tags' },
      },
    },
  ],
};

describe('JeevesWatcher: facet warnings', () => {
  let stateDir: string;
  let app: JeevesWatcher | undefined;
  const logger = pino({ level: 'silent' });
  const warn = vi.spyOn(logger, 'warn');
  const payloadIndexTypes = vi.fn(() => Promise.resolve({ tag: 'keyword' }));

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-startup-fw-'));
    onChanges.length = 0;
    warn.mockClear();
    payloadIndexTypes.mockClear();
  });

  afterEach(async () => {
    await app?.stop();
    app = undefined;
    await rm(stateDir, { recursive: true, force: true, maxRetries: 5 });
  });

  /** The config of these tests, with the given rules. */
  const configWith = (
    inferenceRules: InferenceRule[],
  ): JeevesWatcherConfig => ({
    ...createTestConfig(),
    stateDir,
    configWatch: { enabled: true },
    inferenceRules,
  });

  /** Start the app on `config`, with a config file path in the state dir. */
  async function start(config: JeevesWatcherConfig): Promise<string> {
    const configPath = join(stateDir, 'config.json');
    app = new JeevesWatcher(
      config,
      configPath,
      { name: 'watcher' } as never,
      buildFactories(logger, payloadIndexTypes),
    );
    await app.start();
    return configPath;
  }

  /** The first arguments of the warn calls. */
  const warned = () => warn.mock.calls.map((c) => c[0]);

  it('warns at start about an unknown hint and an unindexed facet field', async () => {
    await start(configWith([RULE]));
    expect(payloadIndexTypes).toHaveBeenCalledOnce();
    expect(warned()).toContainEqual(
      expect.objectContaining({
        rule: 'r',
        property: 'odd',
        uiHint: 'selct',
      }),
    );
    expect(warned()).toContainEqual({ field: 'odd', rules: ['r'] });
    expect(warned()).not.toContainEqual(
      expect.objectContaining({ field: 'tag' }),
    );
  });

  it('warns on a config reload about the reloaded rules', async () => {
    const configPath = await start(configWith([]));
    expect(warned()).toEqual([]);
    await writeFile(configPath, JSON.stringify(configWith([RULE])), 'utf8');
    expect(onChanges).toHaveLength(1);
    await onChanges[0]?.();
    expect(payloadIndexTypes).toHaveBeenCalledTimes(2);
    expect(warned()).toContainEqual({ field: 'odd', rules: ['r'] });
  });
});
