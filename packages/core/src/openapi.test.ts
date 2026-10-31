import { readFileSync } from 'node:fs';

import { checkOpenApiDrift } from '@karmaniverous/jeeves/openapi';
import { describe, expect, it } from 'vitest';

import { OPENAPI_FILE, openApiInfo } from '../scripts/openapiInfo';
import { WATCHER_CATALOG } from './catalog';
import { WATCHER_OPENAPI_DOCUMENT } from './openapi';

interface Operation {
  operationId: string;
  security?: unknown[];
  responses: Record<string, { content?: Record<string, unknown> } | undefined>;
}

type Doc = {
  info: { version: string };
  paths: Record<string, Record<string, Operation>>;
  components?: { securitySchemes?: Record<string, unknown> };
};

const doc = WATCHER_OPENAPI_DOCUMENT as unknown as Doc;
const operations = Object.values(doc.paths).flatMap((methods) =>
  Object.values(methods),
);
const operation = (id: string) => {
  const found = operations.find((op) => op.operationId === id);
  if (!found) throw new Error(`no operation ${id}`);
  return found;
};

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
  files: string[];
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
};

describe('openapi.json', () => {
  it('matches WATCHER_CATALOG (run `npm run openapi` after changing the catalog)', () => {
    const result = checkOpenApiDrift(
      WATCHER_CATALOG,
      openApiInfo(),
      OPENAPI_FILE,
    );
    expect(result.diff).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it('is exported verbatim as WATCHER_OPENAPI_DOCUMENT', () => {
    expect(WATCHER_OPENAPI_DOCUMENT).toEqual(
      JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')),
    );
  });

  it('carries the watcher-core version', () => {
    expect(doc.info.version).toBe(pkg.version);
  });

  it('has one operation per catalog entry', () => {
    expect(operations.map((op) => op.operationId).sort()).toEqual(
      WATCHER_CATALOG.entries.map((e) => e.name).sort(),
    );
  });

  it('leaves status open and requires the bearer key elsewhere', () => {
    expect(operation('status').security).toEqual([]);
    for (const op of operations.filter((o) => o.operationId !== 'status')) {
      expect(op.security).toEqual([expect.objectContaining({})]);
      expect(Object.keys(op.security?.[0] ?? {})).toEqual(
        Object.keys(doc.components?.securitySchemes ?? {}),
      );
    }
  });

  it('serves vcsShow as text/plain', () => {
    expect(
      Object.keys(operation('vcsShow').responses['200']?.content ?? {}),
    ).toEqual(['text/plain']);
  });
});

describe('package.json', () => {
  it('publishes openapi.json as a sub-path export', () => {
    expect(pkg.files).toContain('openapi.json');
    expect(pkg.exports['./openapi.json']).toBe('./openapi.json');
  });

  it('keeps watcher-core free of Fastify', () => {
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('fastify');
  });
});
