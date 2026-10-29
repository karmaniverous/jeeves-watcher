/**
 * @module api/catalog/renderHandler.test
 * `createCatalogRenderHandler`: file renders (transformed/passthrough,
 * outside watch scope, missing, pipeline failure) and source renders
 * (success, not indexed, gone, failed) — every source reply carries
 * `Cache-Control: no-cache`.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { ProcessingFailure } from '../../processor/issueRecording';
import { createCatalogRenderHandler } from './renderHandler';

function input(body: Record<string, unknown>) {
  return { params: {}, query: {}, body } as never;
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    processor: {
      renderFile: vi.fn().mockResolvedValue({
        renderAs: 'md',
        content: '# Rendered',
        rules: ['doc'],
        metadata: { title: 'Rendered' },
        transformed: true,
      }),
      sourceOperations: () => ({
        storedRule: () => Promise.resolve('chat'),
        render: () =>
          Promise.resolve({
            kind: 'ok',
            result: {
              renderAs: 'md',
              content: '# Chat',
              rules: ['chat'],
              metadata: {},
            },
          }),
      }),
      ...overrides,
    } as never,
    getWatch: () => ({ paths: ['**/*.md'], ignored: [] }),
    logger: pino({ level: 'silent' }),
  };
}

describe('createCatalogRenderHandler', () => {
  it('renders a transformed file with no special headers', async () => {
    const handler = createCatalogRenderHandler(deps());

    const result = await handler(input({ path: 'docs/a.md' }), {} as never);

    expect(result.status).toBe(200);
    expect(result.headers).toBeUndefined();
  });

  it('sets Cache-Control: no-cache for a passthrough render', async () => {
    const handler = createCatalogRenderHandler(
      deps({
        renderFile: vi.fn().mockResolvedValue({
          renderAs: 'txt',
          content: 'raw',
          rules: [],
          metadata: {},
          transformed: false,
        }),
      }),
    );

    const result = await handler(input({ path: 'docs/a.md' }), {} as never);

    expect(result.headers).toEqual({ 'Cache-Control': 'no-cache' });
  });

  it('rejects a path outside the watched scope', async () => {
    const handler = createCatalogRenderHandler(deps());

    // 'docs/a.txt' is not matched by the watch config's '**/*.md'.
    const result = await handler(input({ path: 'docs/a.txt' }), {} as never);

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: 'path_not_watched' });
  });

  it('answers a missing file with 404 not_found', async () => {
    const handler = createCatalogRenderHandler(
      deps({
        renderFile: vi.fn().mockRejectedValue(
          Object.assign(new Error('ENOENT: no such file'), {
            code: 'ENOENT',
          }),
        ),
      }),
    );

    const result = await handler(input({ path: 'docs/a.md' }), {} as never);

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ code: 'not_found' });
  });

  it('answers a pipeline failure with 422 pipeline_error', async () => {
    const handler = createCatalogRenderHandler(
      deps({
        renderFile: vi
          .fn()
          .mockRejectedValue(
            new ProcessingFailure('extraction_error', new Error('bad bytes')),
          ),
      }),
    );

    const result = await handler(input({ path: 'docs/a.md' }), {} as never);

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      code: 'pipeline_error',
      issueType: 'extraction_error',
    });
  });

  it.each([
    ['untagged', new Error('boom'), 'extraction_error'],
    [
      'stage-tagged',
      new ProcessingFailure('interpolation_error', new Error('bad template')),
      'interpolation_error',
    ],
  ] as const)(
    'tags a %s render failure with its issueType',
    async (_label, error, issueType) => {
      const handler = createCatalogRenderHandler(
        deps({ renderFile: vi.fn().mockRejectedValue(error) }),
      );

      const result = await handler(input({ path: 'docs/a.md' }), {} as never);

      expect(result.status).toBe(422);
      expect(result.body).toMatchObject({ code: 'pipeline_error', issueType });
    },
  );

  it('answers a file render with exactly the public fields (no transformed flag)', async () => {
    const handler = createCatalogRenderHandler(deps());

    const result = await handler(input({ path: 'docs/a.md' }), {} as never);

    expect(result.body).toEqual({
      renderAs: 'md',
      content: '# Rendered',
      rules: ['doc'],
      metadata: { title: 'Rendered' },
    });
  });

  it('renders a source document with Cache-Control: no-cache', async () => {
    const handler = createCatalogRenderHandler(deps());

    const result = await handler(
      input({ source: 'app://chat/1' }),
      {} as never,
    );

    expect(result).toEqual({
      status: 200,
      body: {
        renderAs: 'md',
        content: '# Chat',
        rules: ['chat'],
        metadata: {},
      },
      headers: { 'Cache-Control': 'no-cache' },
    });
  });

  it('carries Cache-Control: no-cache on a source error reply too', async () => {
    const handler = createCatalogRenderHandler(
      deps({
        sourceOperations: () => ({
          storedRule: () => Promise.resolve(null),
          render: vi.fn(),
        }),
      }),
    );

    const result = await handler(
      input({ source: 'app://chat/1' }),
      {} as never,
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ code: 'source_not_indexed' });
    expect(result.headers).toEqual({ 'Cache-Control': 'no-cache' });
  });
});
