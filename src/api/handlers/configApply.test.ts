import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';

import { ReindexTracker } from '../ReindexTracker';
import type { ConfigApplyRouteDeps } from './configApply';
import { createConfigApplyHandler } from './configApply';

let tempConfigPath: string;

function minimalConfig() {
  return {
    watch: { paths: ['**/*.md'] },
    embedding: { provider: 'mock', model: 'test', dimensions: 3 },
    vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
  };
}

function createDeps(
  overrides: Partial<ConfigApplyRouteDeps> = {},
): ConfigApplyRouteDeps {
  return {
    config: minimalConfig() as any,
    configPath: tempConfigPath,
    reindexTracker: new ReindexTracker(),
    logger: pino({ level: 'silent' }),
    triggerReindex: vi.fn(),
    ...overrides,
  };
}

function mockRequest(body: Record<string, unknown>) {
  return { body } as any;
}

function mockReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
  } as any;
}

describe('createConfigApplyHandler', () => {
  beforeEach(() => {
    const dir = join(tmpdir(), `configApply-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    tempConfigPath = join(dir, 'config.json');
  });

  it('valid config writes to disk and returns applied: true', async () => {
    const deps = createDeps();
    const handler = createConfigApplyHandler(deps);
    const result = await handler(
      mockRequest({ config: { watch: { paths: ['**/*.txt'] } } }),
      mockReply(),
    );

    expect(result).toMatchObject({ applied: true });
    expect(existsSync(tempConfigPath)).toBe(true);
    const written = JSON.parse(readFileSync(tempConfigPath, 'utf-8'));
    expect(written.watch.paths).toEqual(['**/*.txt']);
  });

  it('invalid config returns validation errors and does NOT write', async () => {
    const deps = createDeps();
    const handler = createConfigApplyHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ config: { watch: { paths: [] } } }),
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(existsSync(tempConfigPath)).toBe(false);
  });

  it('triggers reindex based on configWatch.reindex setting', async () => {
    const triggerReindex = vi.fn();
    const deps = createDeps({
      config: { ...minimalConfig(), configWatch: { reindex: 'full' } } as any,
      triggerReindex,
    });
    const handler = createConfigApplyHandler(deps);
    const result = await handler(
      mockRequest({ config: {} }),
      mockReply(),
    );

    expect(result).toMatchObject({ applied: true, reindexTriggered: true, scope: 'full' });
    expect(triggerReindex).toHaveBeenCalledWith('full');
  });

  it('does not trigger reindex when configWatch.reindex is none', async () => {
    const triggerReindex = vi.fn();
    const deps = createDeps({
      config: { ...minimalConfig(), configWatch: { reindex: 'none' } } as any,
      triggerReindex,
    });
    const handler = createConfigApplyHandler(deps);
    const result = await handler(
      mockRequest({ config: {} }),
      mockReply(),
    );

    expect(result).toMatchObject({ applied: true, reindexTriggered: false });
    expect(triggerReindex).not.toHaveBeenCalled();
  });
});
