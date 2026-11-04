/**
 * @module app/startup.processingHealth.test
 * Startup wiring for B5a/B6: JeevesWatcher.start() gives the processor a live processing-limits getter (a reload applies to the next document), hands embedding health to the API, and builds the embedding alert over the live config and version.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiServerOptions } from '../api';
import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingAlertOptions } from '../embedding/healthAlert';
import type { DocumentProcessorDeps } from '../processor';
import { createTestConfig } from '../test/helpers';
import type { JeevesWatcherFactories } from './factories';
import { JeevesWatcher } from './index';

const alertOptions = vi.hoisted(() => ({
  value: undefined as EmbeddingAlertOptions | undefined,
}));

vi.mock('../embedding/healthAlert', () => ({
  createEmbeddingAlert: (options: EmbeddingAlertOptions) => {
    alertOptions.value = options;
    return { onTransition: vi.fn(), settled: () => Promise.resolve() };
  },
}));

interface Captured {
  processorDeps?: DocumentProcessorDeps;
  apiOptions?: ApiServerOptions;
}

function buildFactories(captured: Captured): Partial<JeevesWatcherFactories> {
  return {
    createVectorStoreClient: () =>
      ({
        ensureCollection: vi.fn().mockResolvedValue(undefined),
        ensureTextIndex: vi.fn().mockResolvedValue(undefined),
      }) as never,
    createDocumentProcessor: (deps) => {
      captured.processorDeps = deps;
      return { sourceOperations: () => ({}) } as never;
    },
    createFileSystemWatcher: () =>
      ({ start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }) as never,
    createApiServer: (options) => {
      captured.apiOptions = options;
      return {
        listen: vi.fn().mockResolvedValue(''),
        close: vi.fn().mockResolvedValue(undefined),
      } as never;
    },
  };
}

describe('JeevesWatcher startup: processing limits and embedding health', () => {
  let stateDir: string;
  let captured: Captured;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-startup-ph-'));
    captured = {};
    alertOptions.value = undefined;
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('wires the limits getter, embedding health and the alert', async () => {
    const config: JeevesWatcherConfig = {
      ...createTestConfig(),
      stateDir,
      configWatch: { enabled: false },
      processing: { maxChunksPerFile: 7, maxTextBytes: '1k' },
    };
    const app = new JeevesWatcher(
      config,
      undefined,
      { name: 'watcher' } as never,
      buildFactories(captured),
    );
    await app.start();
    try {
      expect(captured.processorDeps?.getProcessingLimits?.()).toEqual({
        maxFileBytes: 64 * 2 ** 20,
        maxChunksPerFile: 7,
        maxTextBytes: 1024,
      });
      expect(captured.apiOptions?.embeddingHealth?.snapshot().state).toBe('ok');
      expect(alertOptions.value?.getConfig()).toBe(config);
      expect(typeof alertOptions.value?.version).toBe('string');
    } finally {
      await app.stop();
    }
  });
});
