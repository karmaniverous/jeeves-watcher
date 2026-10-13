/**
 * @module api/handlers/configApply.test
 * Drives POST /config/apply through a real Fastify route with the real
 * watcher descriptor and a config file outside any derived configRoot path.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
import { PUBLIC_CONFIG_KEYS } from '../publicConfig';
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

  it('answers an unreadable config file with a generic 500 (no path)', async () => {
    rmSync(configPath);
    mkdirSync(configPath); // reading a directory fails (EISDIR)
    const res = await post({ patch: {} });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: 'internal_error',
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
    expect(res.body).not.toContain('custom-name.json');
    expect(onConfigApply).not.toHaveBeenCalled();
  });

  it('never echoes secrets: the returned config is allow-listed like GET /config', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        ...baseConfig,
        embedding: { ...baseConfig.embedding, apiKey: 'embed-secret' },
        api: { apiKey: 'api-secret' },
        sources: {
          app: {
            url: 'http://x/{id}',
            headers: { Authorization: 'Bearer source-secret' },
          },
        },
      }),
    );
    const res = await post({ patch: { watch: { debounceMs: 250 } } });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ applied: boolean; config: object }>();
    expect(body.applied).toBe(true);
    for (const key of Object.keys(body.config)) {
      expect(PUBLIC_CONFIG_KEYS).toContain(key);
    }
    for (const key of ['api', 'sources', 'embedding', 'vectorStore']) {
      expect(body.config).not.toHaveProperty(key);
    }
    expect(body.config).toMatchObject({ watch: { debounceMs: 250 } });
    expect(res.body).not.toMatch(/secret/);
  });

  it('reports a failed apply callback as 200 with warning, still redacted', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ ...baseConfig, api: { apiKey: 'api-secret' } }),
    );
    onConfigApply.mockRejectedValueOnce(new Error('reload failed'));
    const res = await post({ patch: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ warning: string; config: object }>();
    expect(body.warning).toContain('reload failed');
    expect(body.config).not.toHaveProperty('api');
    expect(res.body).not.toContain('api-secret');
  });

  it('replace: true validates the patch on its own', async () => {
    const res = await post({ patch: {}, replace: true });
    expect(res.statusCode).toBe(400);
    expect(readConfig()).toEqual(baseConfig);
  });
});
