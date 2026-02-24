/**
 * @module api/handlers/configValidate.test
 */

import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';

import type { ConfigValidateRouteDeps } from './configValidate';
import { createConfigValidateHandler } from './configValidate';
import { mergeInferenceRules } from './configMerge';
import type { JeevesWatcherConfig } from '../../config/types';

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
  };
}

function mockRequest<TReq>(body: Record<string, unknown>): TReq {
  return { body } as unknown as TReq;
}

function mockReply<TReply>(): TReply {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
  } as unknown as TReply;
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
    type Req = Parameters<typeof handler>[0];
    type Rep = Parameters<typeof handler>[1];

    const result = (await handler(
      mockRequest<Req>({}),
      mockReply<Rep>(),
    )) as unknown as {
      valid: boolean;
    };

    expect(result).toEqual({ valid: true });
  });

  it('returns valid: false with errors for invalid config', async () => {
    const deps = createDeps();
    const handler = createConfigValidateHandler(deps);
    type Req = Parameters<typeof handler>[0];
    type Rep = Parameters<typeof handler>[1];

    const result = (await handler(
      mockRequest<Req>({ config: { watch: { paths: [] } } }),
      mockReply<Rep>(),
    )) as unknown as { valid: boolean; errors: unknown[] };

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validates helper files: missing file returns error', async () => {
    const deps = createDeps();
    const handler = createConfigValidateHandler(deps);
    type Req = Parameters<typeof handler>[0];
    type Rep = Parameters<typeof handler>[1];

    const result = (await handler(
      mockRequest<Req>({
        config: {
          mapHelpers: {
            myHelper: { path: '/nonexistent/helper.js' },
          },
        },
      }),
      mockReply<Rep>(),
    )) as unknown as {
      valid: boolean;
      errors: Array<{ path: string; message: string }>;
    };

    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('mapHelpers.myHelper.path');
    expect(result.errors[0].message).toContain('File not found');
  });
});
