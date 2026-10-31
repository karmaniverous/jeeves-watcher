/**
 * @module api/catalog/configApplyHandler.test
 * `createCatalogConfigApplySource`: redacts the echoed config on success,
 * adds a `code` to a merge-validation 400 (keeping core's `issues`), and
 * logs + genericizes a 5xx.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watcherDescriptor } from '../../descriptor';
import { createCatalogConfigApplySource } from './configApplyHandler';

const baseConfig = {
  watch: { paths: ['**/*.md'], debounceMs: 100 },
  embedding: { provider: 'mock', model: 'test', dimensions: 3 },
  vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
};

describe('createCatalogConfigApplySource', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jw-catalog-config-apply-'));
    configPath = join(dir, 'custom-name.json');
    writeFileSync(configPath, JSON.stringify(baseConfig, null, 2));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function build(onConfigApply = vi.fn().mockResolvedValue(undefined)) {
    return {
      source: createCatalogConfigApplySource({
        descriptor: watcherDescriptor,
        configPath,
        onConfigApply,
        logger: pino({ level: 'silent' }),
      }),
      onConfigApply,
    };
  }

  it('applies a patch and redacts the echoed config', async () => {
    const { source } = build();
    const result = await source({ patch: { watch: { debounceMs: 500 } } });

    expect(result.status).toBe(200);
    const body = result.body as { applied: boolean; config: object };
    expect(body.applied).toBe(true);
    expect(body.config).not.toHaveProperty('vectorStore');
    expect(body.config).toMatchObject({ watch: { debounceMs: 500 } });
  });

  it('keeps issues and adds a code for a merge-validation 400', async () => {
    const { source } = build();
    const result = await source({
      patch: { embedding: { dimensions: 'three' } },
    });

    expect(result.status).toBe(400);
    const body = result.body as Record<string, unknown>;
    expect(body['code']).toBe('invalid_request');
    expect(Array.isArray(body['issues'])).toBe(true);
  });

  it('logs and genericizes a 5xx without leaking the file path', async () => {
    rmSync(configPath);
    writeFileSync(configPath, '{ invalid json');
    const logger = { error: vi.fn() } as never;
    const source = createCatalogConfigApplySource({
      descriptor: watcherDescriptor,
      configPath,
      onConfigApply: vi.fn().mockResolvedValue(undefined),
      logger,
    });

    const result = await source({ patch: {} });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      code: 'internal_error',
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
    expect(
      (logger as { error: ReturnType<typeof vi.fn> }).error,
    ).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('custom-name.json');
  });

  it('does not write the file when the merge is invalid', async () => {
    const { source, onConfigApply } = build();
    await source({ patch: { embedding: { dimensions: 'three' } } });

    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(baseConfig);
    expect(onConfigApply).not.toHaveBeenCalled();
  });
});
