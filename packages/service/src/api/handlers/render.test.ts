/**
 * @module api/handlers/render.test
 * Tests for POST /render route handler.
 */

import { describe, expect, it, vi } from 'vitest';

import type { RenderResult } from '../../processor/renderResult';
import { createRenderHandler, type RenderHandlerDeps } from './render';

/** Create a mock FastifyReply. */
function mockReply() {
  const reply = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(data: unknown) {
      reply.body = data;
      return Promise.resolve(reply);
    },
    header(key: string, value: string) {
      reply.headers[key] = value;
      return reply;
    },
  };
  return reply;
}

/** Create a mock FastifyRequest with body. */
function mockRequest(body: Record<string, unknown>) {
  return { body } as unknown as Parameters<
    ReturnType<typeof createRenderHandler>
  >[0];
}

const watchConfig = {
  paths: ['j:/domains/**/*.json', 'j:/domains/**/*.md'],
  ignored: ['**/node_modules/**'],
};

const transformedResult: RenderResult = {
  renderAs: 'md',
  content: '---\nchannelName: test\n---\n# Message\nHello',
  rules: ['slack-message'],
  metadata: { entity_type: 'message', domains: ['slack'] },
  transformed: true,
};

const passthroughResult: RenderResult = {
  renderAs: 'md',
  content: '# Hello\nworld',
  rules: [],
  metadata: {},
  transformed: false,
};

function makeDeps(
  overrides: Partial<RenderHandlerDeps> = {},
): RenderHandlerDeps {
  return {
    processor: {
      processFile: vi.fn(),
      deleteFile: vi.fn(),
      processMetadataUpdate: vi.fn(),
      processRulesUpdate: vi.fn(),
      updateRules: vi.fn(),
      renderFile: vi.fn().mockResolvedValue(transformedResult),
    },
    watch: watchConfig,
    logger: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    } as unknown as RenderHandlerDeps['logger'],
    ...overrides,
  } as RenderHandlerDeps;
}

describe('POST /render handler', () => {
  it('returns rendered content for a transformed file', async () => {
    const deps = makeDeps();
    const handler = createRenderHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ path: 'j:/domains/slack/msg.json' }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    expect(reply.body).toEqual({
      renderAs: 'md',
      content: transformedResult.content,
      rules: ['slack-message'],
      metadata: { entity_type: 'message', domains: ['slack'] },
    });
  });

  it('returns passthrough content for a non-transformed file', async () => {
    const deps = makeDeps();
    vi.mocked(deps.processor.renderFile).mockResolvedValueOnce(
      passthroughResult,
    );
    const handler = createRenderHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ path: 'j:/domains/docs/readme.md' }),
      reply as never,
    );

    expect(reply.statusCode).toBe(200);
    expect(reply.body).toEqual({
      renderAs: 'md',
      content: passthroughResult.content,
      rules: [],
      metadata: {},
    });
  });

  it('sets Cache-Control: no-cache for passthrough responses', async () => {
    const deps = makeDeps();
    vi.mocked(deps.processor.renderFile).mockResolvedValueOnce(
      passthroughResult,
    );
    const handler = createRenderHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ path: 'j:/domains/docs/readme.md' }),
      reply as never,
    );

    expect(reply.headers['Cache-Control']).toBe('no-cache');
  });

  it('does not set Cache-Control for transformed responses', async () => {
    const deps = makeDeps();
    const handler = createRenderHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ path: 'j:/domains/slack/msg.json' }),
      reply as never,
    );

    expect(reply.headers['Cache-Control']).toBeUndefined();
  });

  it('returns 403 for paths outside watched scope', async () => {
    const deps = makeDeps();
    const handler = createRenderHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ path: 'c:/windows/system32/cmd.exe' }),
      reply as never,
    );

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toEqual({ error: 'Path is outside watched scope' });
  });

  it('returns 404 when file is not found', async () => {
    const deps = makeDeps();
    vi.mocked(deps.processor.renderFile).mockRejectedValueOnce(
      new Error('ENOENT: no such file or directory'),
    );
    const handler = createRenderHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ path: 'j:/domains/slack/missing.json' }),
      reply as never,
    );

    expect(reply.statusCode).toBe(404);
    expect(reply.body).toEqual({ error: 'File not found' });
  });

  it('returns 400 for missing path', async () => {
    const deps = makeDeps();
    const handler = createRenderHandler(deps);
    const reply = mockReply();

    await handler(mockRequest({}), reply as never);

    expect(reply.statusCode).toBe(400);
  });

  it('returns 422 for other errors', async () => {
    const deps = makeDeps();
    vi.mocked(deps.processor.renderFile).mockRejectedValueOnce(
      new Error('Extraction failed'),
    );
    const handler = createRenderHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ path: 'j:/domains/slack/bad.json' }),
      reply as never,
    );

    expect(reply.statusCode).toBe(422);
    expect(reply.body).toEqual({ error: 'Extraction failed' });
  });

  it('does not include transformed flag in response', async () => {
    const deps = makeDeps();
    const handler = createRenderHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({ path: 'j:/domains/slack/msg.json' }),
      reply as never,
    );

    const body = reply.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('transformed');
  });
});
