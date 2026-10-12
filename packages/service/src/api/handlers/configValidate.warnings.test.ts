/**
 * @module api/handlers/configValidate.warnings.test
 * Tests that POST /config/validate surfaces reserved-field warnings without failing validation.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import { createConfigValidateHandler } from './configValidate';

type Handler = ReturnType<typeof createConfigValidateHandler>;

const handler = createConfigValidateHandler({
  getConfig: () =>
    ({
      watch: { paths: ['**/*.md'] },
      embedding: { provider: 'mock', model: 'test', dimensions: 3 },
      vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
    }) as unknown as JeevesWatcherConfig,
  logger: pino({ level: 'silent' }),
  configDir: process.cwd(),
});

async function validate(config: Record<string, unknown>) {
  const send = vi.fn();
  const reply = {
    status: vi.fn().mockReturnThis(),
    send,
    sent: false,
  } as unknown as Parameters<Handler>[1];
  await handler(
    { body: { config } } as unknown as Parameters<Handler>[0],
    reply,
  );
  return send.mock.calls[0][0] as {
    valid: boolean;
    warnings?: Array<{ path: string; message: string }>;
  };
}

const rule = (properties: Record<string, unknown>) => ({
  name: 'r',
  description: 'd',
  match: { type: 'object' },
  schema: [{ type: 'object', properties }],
});

describe('POST /config/validate reserved-field warnings', () => {
  it('stays valid and reports warnings for reserved property names', async () => {
    const result = await validate({
      inferenceRules: [rule({ source: { type: 'string' } })],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ path: 'inferenceRules[r].schema.source' }),
    ]);
  });

  it('omits warnings when none apply', async () => {
    const result = await validate({
      inferenceRules: [rule({ domain: { type: 'string' } })],
    });
    expect(result).toEqual({ valid: true });
  });
});
