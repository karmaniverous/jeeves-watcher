/**
 * @module api/handlers/configSchema.test
 * GET /config/schema: the JSON Schema covers exactly the merged document's keys (public allow-list plus issues, no legacy `slots`), takes each config key from the core schema (`schemas` is a record), adds the runtime rule fields, and a real merged document validates against it.
 */

import { jeevesWatcherConfigSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { JeevesWatcherConfig } from '../../config/types';
import type { IssuesManager } from '../../issues';
import type { ValuesManager } from '../../values';
import { buildMergedDocument } from '../mergedDocument';
import { PUBLIC_CONFIG_KEYS } from '../publicConfig';
import { createConfigSchemaHandler, mergedConfigSchema } from './configSchema';

interface JsonSchemaObject {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
}

async function served(): Promise<JsonSchemaObject> {
  const send = vi.fn();
  await createConfigSchemaHandler()(
    {} as FastifyRequest,
    { send } as unknown as FastifyReply,
  );
  return send.mock.calls[0][0] as JsonSchemaObject;
}

/** JSON Schema of one core config field, optional wrapper removed. */
function coreField(key: 'schemas' | 'search' | 'configWatch') {
  return z.toJSONSchema(jeevesWatcherConfigSchema.shape[key].unwrap(), {
    unrepresentable: 'any',
  });
}

describe('GET /config/schema handler', () => {
  it('describes exactly the merged document keys, all required', async () => {
    const schema = await served();
    const keys = [...PUBLIC_CONFIG_KEYS, 'issues'].sort();

    expect(Object.keys(schema.properties).sort()).toEqual(keys);
    expect(schema.properties).not.toHaveProperty('slots');
    expect([...schema.required].sort()).toEqual(keys);
  });

  it('takes config keys from the core schema (schemas is a record)', async () => {
    const { properties } = await served();

    expect(properties['schemas']).toMatchObject({ type: 'object' });
    for (const key of ['schemas', 'search', 'configWatch'] as const) {
      const expected = Object.fromEntries(
        Object.entries(coreField(key)).filter(([k]) => k !== '$schema'),
      );
      // The served property also carries the core field's description.
      expect(properties[key]).toMatchObject(expected);
    }
  });

  it('adds source and values to every rule', async () => {
    const { properties } = await served();
    const items = (properties['inferenceRules'] as { items: JsonSchemaObject })
      .items;

    expect(items.properties).toHaveProperty('source');
    expect(items.properties).toHaveProperty('values');
    expect(items.required).toEqual(
      expect.arrayContaining(['source', 'values']),
    );
  });

  it('validates a merged document built from a config', () => {
    const doc = buildMergedDocument({
      config: {
        watch: { paths: ['**/*.md'] },
        embedding: { provider: 'mock' },
        vectorStore: { url: 'http://localhost:6333', collectionName: 'c' },
        schemas: { base: { type: 'object', properties: {} } },
        inferenceRules: [
          { name: 'docs', description: 'Docs', match: {}, schema: ['base'] },
        ],
        mapHelpers: { util: { path: './helpers.js' } },
      } as unknown as JeevesWatcherConfig,
      valuesManager: {
        getForRule: vi.fn().mockReturnValue({ domain: ['docs'] }),
      } as unknown as ValuesManager,
      issuesManager: {
        getAll: vi.fn().mockReturnValue({
          '/data/a.md': [
            { type: 'extraction_error', message: 'bad', timestamp: 1 },
          ],
        }),
      } as unknown as IssuesManager,
      helperIntrospection: {
        mapHelpers: { util: { exports: { util_trim: 'Trim a string' } } },
        templateHelpers: {},
      },
    });

    expect(mergedConfigSchema.safeParse(doc).error).toBeUndefined();
  });
});
