/**
 * @module api/catalog/renderHandler.test
 * `createCatalogRenderHandler`: file renders (transformed/passthrough,
 * outside watch scope, missing, pipeline failure by issue type) and source
 * renders (success with `Cache-Control: no-cache`; an error is a thrown
 * class, with no other header).
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { ProcessingFailure } from '../../processor/issueRecording';
import { pipelineErrorCode } from '../errors';
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
    await expect(
      handler(input({ path: 'docs/a.txt' }), {} as never),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'WATCHER_PATH_NOT_WATCHED',
    });
  });

  it('answers a missing file with 404 WATCHER_NOT_FOUND', async () => {
    const handler = createCatalogRenderHandler(
      deps({
        renderFile: vi.fn().mockRejectedValue(
          Object.assign(new Error('ENOENT: no such file'), {
            code: 'ENOENT',
          }),
        ),
      }),
    );

    await expect(
      handler(input({ path: 'docs/a.md' }), {} as never),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'WATCHER_NOT_FOUND',
      message: 'The file or directory does not exist.',
    });
  });

  it('answers a missing file reported only in the error message with 404', async () => {
    const handler = createCatalogRenderHandler(
      deps({
        renderFile: vi
          .fn()
          .mockRejectedValue(
            new Error('read failed', { cause: new Error('no such file') }),
          ),
      }),
    );

    await expect(
      handler(input({ path: 'docs/a.md' }), {} as never),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'WATCHER_NOT_FOUND',
      message: 'The file or directory does not exist.',
    });
  });
  it('answers a pipeline failure with its 422 pipeline code, logging the failure but never its text', async () => {
    const failure = new ProcessingFailure(
      'extraction_error',
      new Error('EACCES: /secret/x.pdf'),
    );
    const warn = vi.fn();
    const handler = createCatalogRenderHandler({
      ...deps({ renderFile: vi.fn().mockRejectedValue(failure) }),
      logger: { warn } as never,
    });

    const error = await handler(
      input({ path: 'docs/a.md' }),
      {} as never,
    ).catch((e: unknown) => e);

    expect(error).toMatchObject({
      statusCode: 422,
      code: 'WATCHER_PIPELINE_EXTRACTION_ERROR',
      message: 'The document could not be extracted.',
    });
    expect(JSON.stringify(error)).not.toContain('/secret/');
    expect(warn).toHaveBeenCalledWith(
      { filePath: 'docs/a.md', err: failure, details: failure.details },
      'Render failed',
    );
  });

  it.each([
    ['untagged', new Error('boom'), 'extraction_error'],
    [
      'stage-tagged',
      new ProcessingFailure('interpolation_error', new Error('bad template')),
      'interpolation_error',
    ],
  ] as const)(
    'sends a %s render failure as the pipeline code of %s',
    async (_label, error, issueType) => {
      const handler = createCatalogRenderHandler(
        deps({ renderFile: vi.fn().mockRejectedValue(error) }),
      );

      await expect(
        handler(input({ path: 'docs/a.md' }), {} as never),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: pipelineErrorCode(issueType),
      });
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

  it('throws a source error as its class (no Cache-Control)', async () => {
    const handler = createCatalogRenderHandler(
      deps({
        sourceOperations: () => ({
          storedRule: () => Promise.resolve(null),
          render: vi.fn(),
        }),
      }),
    );

    const error = await handler(
      input({ source: 'app://chat/1' }),
      {} as never,
    ).catch((e: unknown) => e);

    expect(error).toMatchObject({
      statusCode: 404,
      code: 'WATCHER_SOURCE_NOT_INDEXED',
    });
    expect(error).not.toHaveProperty('headers');
  });
});
