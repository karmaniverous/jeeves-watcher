/**
 * @module api/catalog/issuesHandler.test
 * `createCatalogIssuesHandler`: `{ count, issues }` from the issues store.
 */

import { describe, expect, it } from 'vitest';

import type { IssuesFile } from '../../issues/types';
import { createCatalogIssuesHandler } from './issuesHandler';

describe('createCatalogIssuesHandler', () => {
  it('returns count and issues', async () => {
    const issues: IssuesFile = {
      'a.md': [{ type: 'interpolation_error', message: 'x', timestamp: 0 }],
      'b.md': [{ type: 'type_collision', message: 'y', timestamp: 0 }],
    };

    const handler = createCatalogIssuesHandler({
      issuesManager: {
        getAll: () => issues,
      },
    });

    expect(await handler({} as never, {} as never)).toEqual({
      status: 200,
      body: { count: 2, issues },
    });
  });
});
