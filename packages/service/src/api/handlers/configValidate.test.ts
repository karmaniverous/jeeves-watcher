/**
 * @module api/handlers/configValidate.test
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import { mergeInferenceRules } from './configMerge';
import type { ConfigValidateRouteDeps } from './configValidate';
import { createConfigValidateHandler } from './configValidate';

// Minimal valid config for Zod schema
function minimalConfig() {
  return {
    watch: { paths: ['**/*.md'] },
    embedding: { provider: 'mock', model: 'test', dimensions: 3 },
    vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
  };
}

function createDeps(
  configOverrides: Record<string, unknown> = {},
): ConfigValidateRouteDeps {
  return {
    config: {
      ...minimalConfig(),
      ...configOverrides,
    } as unknown as JeevesWatcherConfig,
    logger: pino({ level: 'silent' }),
    configDir: process.cwd(),
  };
}

type Handler = ReturnType<typeof createConfigValidateHandler>;

function mockRequest(body: Record<string, unknown>) {
  return { body } as unknown as Parameters<Handler>[0];
}

function mockReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
  } as unknown as Parameters<Handler>[1];
}

describe('mergeInferenceRules', () => {
  it('appends new rules', () => {
    const existing = [{ name: 'a', set: {} }];
    const incoming = [{ name: 'b', set: {} }];
    const result = mergeInferenceRules(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ name: 'b', set: {} });
  });

  it('replaces existing rules by name', () => {
    const existing = [{ name: 'a', set: { old: true } }];
    const incoming = [{ name: 'a', set: { new: true } }];
    const result = mergeInferenceRules(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'a', set: { new: true } });
  });

  it('keeps missing rules', () => {
    const existing = [
      { name: 'a', set: {} },
      { name: 'b', set: {} },
    ];
    const incoming = [{ name: 'a', set: { updated: true } }];
    const result = mergeInferenceRules(existing, incoming);
    expect(result).toHaveLength(2);
    expect(
      result.find((r: Record<string, unknown>) => r['name'] === 'b'),
    ).toBeDefined();
  });

  it('returns existing when incoming is undefined', () => {
    const existing = [{ name: 'a' }];
    expect(mergeInferenceRules(existing, undefined)).toEqual(existing);
  });

  it('returns incoming when existing is undefined', () => {
    const incoming = [{ name: 'a' }];
    expect(mergeInferenceRules(undefined, incoming)).toEqual(incoming);
  });
});

describe('createConfigValidateHandler', () => {
  it('returns valid: true for valid config', async () => {
    const deps = createDeps();
    const handler = createConfigValidateHandler(deps);
    const reply = mockReply();

    await handler(mockRequest({}), reply);

    expect((reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      valid: true,
    });
  });

  it('returns valid: false with errors for invalid config', async () => {
    const deps = createDeps();
    const handler = createConfigValidateHandler(deps);
    const reply = mockReply();

    await handler(mockRequest({ config: { watch: { paths: [] } } }), reply);

    const result = (reply.send as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      valid: boolean;
      errors: unknown[];
    };
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validates helper files: missing file returns error', async () => {
    const deps = createDeps();
    const handler = createConfigValidateHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({
        config: {
          mapHelpers: {
            myHelper: { path: '/nonexistent/helper.js' },
          },
        },
      }),
      reply,
    );

    const result = (reply.send as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      valid: boolean;
      errors: Array<{ path: string; message: string }>;
    };

    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('mapHelpers.myHelper.path');
    expect(result.errors[0].message).toContain('File not found');
  });

  it('validates helper files: relative path is resolved against configDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jw-cv-'));
    const helperPath = join(dir, 'helper.js');
    writeFileSync(helperPath, 'export default () => {}', 'utf8');

    const deps = { ...createDeps(), configDir: dir };
    const handler = createConfigValidateHandler(deps);
    const reply = mockReply();

    await handler(
      mockRequest({
        config: {
          mapHelpers: {
            myHelper: { path: './helper.js' },
          },
        },
      }),
      reply,
    );

    const result = (reply.send as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      valid: boolean;
    };

    expect(result.valid).toBe(true);
  });
});
