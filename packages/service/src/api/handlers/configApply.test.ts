/**
 * @module api/handlers/configApply.test
 * Drives POST /config/apply through a real Fastify route with the real
 * watcher descriptor and a config file outside any derived configRoot path.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import { watcherDescriptor } from '../../descriptor';
import { createConfigApplyRouteHandler } from './configApply';

const baseConfig = {
  watch: { paths: ['**/*.md'], debounceMs: 100 },
  embedding: { provider: 'mock', model: 'test', dimensions: 3 },
  vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
  inferenceRules: [
    { name: 'keep-me', description: 'kept', match: { type: 'object' } },
  ],
};

describe('POST /config/apply', () => {
  let dir: string;
  let configPath: string;
  let app: FastifyInstance;
  let onConfigApply: Mock<(config: unknown) => Promise<void>>;

  const readConfig = () =>
    JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;

  const post = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/config/apply',
      payload: payload as object,
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jw-config-apply-'));
    configPath = join(dir, 'custom-name.json');
    writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));
    onConfigApply = vi
      .fn<(config: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    app = Fastify();
    app.post(
      '/config/apply',
      createConfigApplyRouteHandler({
        descriptor: watcherDescriptor,
        configPath,
        onConfigApply,
      }),
    );
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts an empty patch and keeps the running config', async () => {
    const res = await post({ patch: {} });
    expect(res.statusCode).toBe(200);
    expect(readConfig()).toMatchObject(baseConfig);
    expect(onConfigApply).toHaveBeenCalledTimes(1);
  });

  it('accepts the { config } body shape', async () => {
    const res = await post({ config: {} });
    expect(res.statusCode).toBe(200);
  });

  it('deep-merges a single nested key without dropping siblings', async () => {
    const res = await post({ patch: { watch: { debounceMs: 500 } } });
    expect(res.statusCode).toBe(200);
    const written = readConfig();
    expect(written['watch']).toMatchObject({
      paths: ['**/*.md'],
      debounceMs: 500,
    });
    expect(written['embedding']).toMatchObject(baseConfig.embedding);
  });

  it('merges inferenceRules by name', async () => {
    const res = await post({
      patch: {
        inferenceRules: [
          { name: 'new-rule', description: 'new', match: { type: 'object' } },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const names = (readConfig()['inferenceRules'] as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(['keep-me', 'new-rule']);
  });

  it('rejects a patch that makes the merged config invalid', async () => {
    const res = await post({ patch: { embedding: { dimensions: 'three' } } });
    expect(res.statusCode).toBe(400);
    expect(readConfig()).toEqual(baseConfig);
    expect(onConfigApply).not.toHaveBeenCalled();
  });

  it('rejects a non-object patch', async () => {
    const res = await post({ patch: [1, 2] });
    expect(res.statusCode).toBe(400);
  });

  it('replace: true validates the patch on its own', async () => {
    const res = await post({ patch: {}, replace: true });
    expect(res.statusCode).toBe(400);
    expect(readConfig()).toEqual(baseConfig);
  });
});
