/**
 * @module api/catalog/configValidateHandler.test
 * `createCatalogConfigValidateHandler`: valid and invalid candidates,
 * helper-file checks (missing, relative to configDir), file-based global
 * schemas resolved against configDir (#256), and test-path results.
 * (`mergeInferenceRules` is covered in `handlers/configMerge.test`.)
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import {
  type CatalogConfigValidateDeps,
  createCatalogConfigValidateHandler,
} from './configValidateHandler';

/** Minimal valid config for the Zod schema. */
function minimalConfig() {
  return {
    watch: { paths: ['**/*.md'] },
    embedding: { provider: 'mock', model: 'test', dimensions: 3 },
    vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
  };
}

function createDeps(
  configOverrides: Record<string, unknown> = {},
): CatalogConfigValidateDeps {
  return {
    getConfig: () =>
      ({
        ...minimalConfig(),
        ...configOverrides,
      }) as unknown as JeevesWatcherConfig,
    logger: pino({ level: 'silent' }),
    configDir: process.cwd(),
  };
}

interface ValidateBody {
  valid: boolean;
  errors?: Array<{ path: string; message: string }>;
  testResults?: Array<{
    path: string;
    matchedRules: string[];
    error?: string;
  }>;
}

async function validate(
  deps: CatalogConfigValidateDeps,
  body: Record<string, unknown>,
): Promise<ValidateBody> {
  const result = await createCatalogConfigValidateHandler(deps)(
    { params: {}, query: {}, body },
    {} as never,
  );
  expect(result.status).toBe(200);
  return result.body as ValidateBody;
}

describe('createCatalogConfigValidateHandler', () => {
  it('returns valid: true for valid config', async () => {
    expect(await validate(createDeps(), {})).toEqual({ valid: true });
  });

  it('returns valid: false with errors for invalid config', async () => {
    const result = await validate(createDeps(), {
      config: { watch: { paths: [] } },
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('validates helper files: missing file returns error', async () => {
    const result = await validate(createDeps(), {
      config: { mapHelpers: { myHelper: { path: '/nonexistent/helper.js' } } },
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.[0].path).toBe('mapHelpers.myHelper.path');
    expect(result.errors?.[0].message).toContain('File not found');
  });

  it('validates helper files: relative path is resolved against configDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jw-cv-'));
    writeFileSync(join(dir, 'helper.js'), 'export default () => {}', 'utf8');

    const result = await validate(
      { ...createDeps(), configDir: dir },
      { config: { mapHelpers: { myHelper: { path: './helper.js' } } } },
    );

    expect(result.valid).toBe(true);
  });

  it('reports matched rules for test paths, and File not found for a missing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jw-cv-paths-'));
    const doc = join(dir, 'a.md');
    writeFileSync(doc, '# A', 'utf8');
    const missing = join(dir, 'missing.md');

    const result = await validate(
      createDeps({
        inferenceRules: [
          {
            name: 'md',
            description: 'Markdown',
            match: {
              type: 'object',
              properties: {
                file: {
                  type: 'object',
                  properties: {
                    extension: { type: 'string', const: '.md' },
                  },
                },
              },
            },
            schema: [],
          },
        ],
      }),
      { testPaths: [doc, missing] },
    );

    expect(result.valid).toBe(true);
    expect(result.testResults).toEqual([
      expect.objectContaining({ path: doc, matchedRules: ['md'] }),
      {
        path: missing,
        matchedRules: [],
        metadata: {},
        error: 'File not found',
      },
    ]);
  });

  describe('file-based global schemas (#256)', () => {
    function schemaConfig() {
      return {
        schemas: { base: '../schemas/base.json' },
        inferenceRules: [
          {
            name: 'uses-file-schema',
            description: 'Rule whose schema is a file-based global schema.',
            match: { type: 'object' },
            schema: ['base'],
          },
        ],
      };
    }

    function writeSchemaTree() {
      const root = mkdtempSync(join(tmpdir(), 'jw-cv-schema-'));
      const configDir = join(root, 'jeeves-watcher');
      mkdirSync(configDir);
      mkdirSync(join(root, 'schemas'));
      writeFileSync(
        join(root, 'schemas', 'base.json'),
        JSON.stringify({
          type: 'object',
          properties: { title: { type: 'string', set: '{{file.filename}}' } },
        }),
        'utf8',
      );
      return configDir;
    }

    it('resolves relative schema paths against configDir, not cwd', async () => {
      const configDir = writeSchemaTree();

      const result = await validate(
        { ...createDeps(schemaConfig()), configDir },
        {},
      );

      expect(result).toEqual({ valid: true });
    });

    it('reports a missing schema file resolved against configDir', async () => {
      const configDir = mkdtempSync(join(tmpdir(), 'jw-cv-noschema-'));

      const result = await validate(
        { ...createDeps(schemaConfig()), configDir },
        {},
      );

      expect(result.valid).toBe(false);
      expect(result.errors?.[0].path).toBe('inferenceRules[uses-file-schema]');
      expect(result.errors?.[0].message).toContain(
        join(configDir, '..', 'schemas', 'base.json'),
      );
    });
  });
});
