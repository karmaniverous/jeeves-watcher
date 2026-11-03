/**
 * @module api/catalog/configMatchHandler.test
 * `createCatalogConfigMatchHandler`: matching rule names and watch scope
 * per path, and recompiling only when the config object changes.
 */

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import { createCatalogConfigMatchHandler } from './configMatchHandler';

function configWith(ruleGlob: string): JeevesWatcherConfig {
  return {
    watch: { paths: ['docs/**/*.md'], ignored: ['docs/private/**'] },
    embedding: { provider: 'mock', model: 'test' },
    vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
    inferenceRules: [
      {
        name: 'docs-md',
        description: 'Docs markdown',
        match: {
          type: 'object',
          properties: {
            file: {
              type: 'object',
              properties: { path: { type: 'string', glob: ruleGlob } },
            },
          },
        },
        schema: [],
      },
    ],
  };
}

function match(handler: ReturnType<typeof createCatalogConfigMatchHandler>) {
  return (paths: string[]) =>
    handler({ params: {}, query: {}, body: { paths } }, {} as never);
}

describe('createCatalogConfigMatchHandler', () => {
  const logger = pino({ level: 'silent' });

  it('returns matching rule names and watch scope per path', async () => {
    const config = configWith('docs/**/*.md');
    const handler = createCatalogConfigMatchHandler({
      getConfig: () => config,
      logger,
    });

    const result = await match(handler)([
      'docs/readme.md',
      'docs/private/secret.md',
      'src/index.ts',
    ]);

    expect(result).toEqual({
      status: 200,
      body: {
        matches: [
          { rules: ['docs-md'], watched: true },
          { rules: ['docs-md'], watched: false },
          { rules: [], watched: false },
        ],
      },
    });
  });

  it('recompiles the rules after a config reload', async () => {
    let config = configWith('docs/**/*.md');
    const handler = createCatalogConfigMatchHandler({
      getConfig: () => config,
      logger,
    });
    const run = match(handler);

    expect((await run(['docs/a.md'])).body).toEqual({
      matches: [{ rules: ['docs-md'], watched: true }],
    });

    config = configWith('other/**');

    expect((await run(['docs/a.md'])).body).toEqual({
      matches: [{ rules: [], watched: true }],
    });
  });
});
