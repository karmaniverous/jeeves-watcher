import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import { ReindexTracker } from '../ReindexTracker';
import type { ConfigApplyRouteDeps } from './configApply';
import { createConfigApplyHandler } from './configApply';

type ConfigApplyRequest = FastifyRequest<{
  Body: { config: Record<string, unknown> };
}>;

interface MockReply {
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

let tempConfigPath: string;

function minimalConfig(): Partial<JeevesWatcherConfig> {
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
    config: minimalConfig() as JeevesWatcherConfig,
    configPath: tempConfigPath,
    reindexTracker: new ReindexTracker(),
    logger: pino({ level: 'silent' }),
    triggerReindex: vi.fn(),
    ...overrides,
  };
}

function mockRequest(body: Record<string, unknown>): ConfigApplyRequest {
  return { body } as unknown as ConfigApplyRequest;
}

function mockReply(): MockReply {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
  };
}

describe('createConfigApplyHandler', () => {
  beforeEach(() => {
    const dir = join(tmpdir(), `configApply-test-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    tempConfigPath = join(dir, 'config.json');
  });

  it('valid config writes to disk and returns applied: true', async () => {
    const deps = createDeps();
    const handler = createConfigApplyHandler(deps);
    const result = await handler(
      mockRequest({ config: { watch: { paths: ['**/*.txt'] } } }),
      mockReply() as unknown as FastifyReply,
    );

    expect(result).toMatchObject({ applied: true });
    expect(existsSync(tempConfigPath)).toBe(true);
    const written = JSON.parse(readFileSync(tempConfigPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    expect((written['watch'] as Record<string, unknown>)['paths']).toEqual([
      '**/*.txt',
    ]);
  });

  it('invalid config returns validation errors and does NOT write', async () => {
    const deps = createDeps();
    const handler = createConfigApplyHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ config: { watch: { paths: [] } } }),
      reply as unknown as FastifyReply,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(existsSync(tempConfigPath)).toBe(false);
  });

  it('triggers reindex based on configWatch.reindex setting', async () => {
    const triggerReindex = vi.fn();
    const deps = createDeps({
      config: {
        ...minimalConfig(),
        configWatch: { reindex: 'full' },
      } as JeevesWatcherConfig,
      triggerReindex,
    });
    const handler = createConfigApplyHandler(deps);
    const result = await handler(
      mockRequest({ config: {} }),
      mockReply() as unknown as FastifyReply,
    );

    expect(result).toMatchObject({
      applied: true,
      reindexTriggered: true,
      scope: 'full',
    });
    expect(triggerReindex).toHaveBeenCalledWith('full');
  });

  it('triggers issues reindex by default when configWatch is empty', async () => {
    const triggerReindex = vi.fn();
    const deps = createDeps({
      config: {
        ...minimalConfig(),
        configWatch: {},
      } as JeevesWatcherConfig,
      triggerReindex,
    });
    const handler = createConfigApplyHandler(deps);
    const result = await handler(
      mockRequest({ config: {} }),
      mockReply() as unknown as FastifyReply,
    );

    expect(result).toMatchObject({
      applied: true,
      reindexTriggered: true,
      scope: 'issues',
    });
    expect(triggerReindex).toHaveBeenCalledWith('issues');
  });
});
