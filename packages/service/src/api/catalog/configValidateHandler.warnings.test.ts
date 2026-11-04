/**
 * @module api/catalog/configValidateHandler.warnings.test
 * Tests that POST /config/validate surfaces reserved-field and unknown source-key warnings without failing validation.
 */

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import { createCatalogConfigValidateHandler } from './configValidateHandler';

const handler = createCatalogConfigValidateHandler({
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
  const result = await handler(
    { params: {}, query: {}, body: { config } },
    {} as never,
  );
  return result.body as {
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

  it('stays valid and warns about unknown keys under sources.<name>', async () => {
    const result = await validate({
      sources: { app: { url: 'http://x/{id}', batchUrl: 'http://x/batch' } },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ path: 'sources.app.batchUrl' }),
    ]);
  });

  it('omits warnings when none apply', async () => {
    const result = await validate({
      inferenceRules: [rule({ domain: { type: 'string' } })],
    });
    expect(result).toEqual({ valid: true });
  });
});
