/**
 * @module api/onRulesChangedRejection.test
 * Tests that onRulesChanged logs errors instead of swallowing async rejection (#161).
 */

import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { VirtualRuleStore } from '../rules/virtualRules';

// Mock buildTemplateEngineAndCustomMapLib to reject
vi.mock('../app/initialization', () => ({
  buildTemplateEngineAndCustomMapLib: vi
    .fn()
    .mockRejectedValue(new Error('template build failed')),
}));

// Mock executeReindex so auto-reindex does not run
vi.mock('./executeReindex', () => ({
  CONFIG_WATCH_VALID_SCOPES: [],
  executeReindex: vi.fn().mockResolvedValue({}),
}));

import { buildTemplateEngineAndCustomMapLib } from '../app/initialization';
import { createOnRulesChanged } from './onRulesChanged';

function makeConfig(): JeevesWatcherConfig {
  return {
    inferenceRules: [],
    watch: { paths: [], ignored: [] },
    vectorStore: { collectionName: 'test', url: '', dimensions: 768 },
    embedding: { provider: 'openai', model: 'text-embedding-3-small' },
    stateDir: '/tmp',
  } as unknown as JeevesWatcherConfig;
}

describe('onRulesChanged rejection handling (#161)', () => {
  it('logs error and does not throw when template engine rebuild fails', async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const processor = { updateRules: vi.fn() };
    const virtualRuleStore = new VirtualRuleStore();
    const reindexTracker = {
      finish: vi.fn(),
      getStatus: vi.fn(),
      start: vi.fn(),
    };
    const valuesManager = { getAll: vi.fn().mockReturnValue({}) };
    const issuesManager = { getAll: vi.fn().mockReturnValue({}) };

    const onRulesChanged = createOnRulesChanged({
      configPath: '/tmp/config.json',
      getConfig: makeConfig,
      gitignoreFilter: undefined,
      issuesManager: issuesManager as never,
      logger: logger as never,
      processor: processor as never,
      reindexTracker: reindexTracker as never,
      valuesManager: valuesManager as never,
      vectorStore: {} as never,
      virtualRuleStore,
    });

    // Should not throw synchronously
    expect(() => {
      onRulesChanged();
    }).not.toThrow();

    // Give the async rejection time to settle
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Error should have been logged
    expect(logger.error).toHaveBeenCalled();
    const call = (logger.error as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown[];
    expect(call[0]).toHaveProperty('err');
    expect(call[1]).toContain('onRulesChanged');

    // Processor should NOT have been updated (rejection happened before .then)
    expect(processor.updateRules).not.toHaveBeenCalled();
  });

  it('calls processor.updateRules when template engine rebuild succeeds', async () => {
    // Override mock to succeed for this test
    vi.mocked(buildTemplateEngineAndCustomMapLib).mockResolvedValueOnce({
      customMapLib: {} as never,
      templateEngine: {} as never,
    });

    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const processor = { updateRules: vi.fn() };
    const virtualRuleStore = new VirtualRuleStore();
    const reindexTracker = {
      finish: vi.fn(),
      getStatus: vi.fn(),
      start: vi.fn(),
    };

    const onRulesChanged = createOnRulesChanged({
      configPath: '/tmp/config.json',
      getConfig: makeConfig,
      gitignoreFilter: undefined,
      issuesManager: { getAll: vi.fn().mockReturnValue({}) } as never,
      logger: logger as never,
      processor: processor as never,
      reindexTracker: reindexTracker as never,
      valuesManager: { getAll: vi.fn().mockReturnValue({}) } as never,
      vectorStore: {} as never,
      virtualRuleStore,
    });

    onRulesChanged();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(processor.updateRules).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
