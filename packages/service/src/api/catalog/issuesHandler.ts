/**
 * @module api/catalog/issuesHandler
 * Catalog handler for `GET /issues`: the current processing issues.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import type { IssuesManager } from '../../issues';
import type { Entry } from './catalogEntry';

/** Dependencies for the catalog `issues` entry's handler. */
export interface CatalogIssuesDeps {
  /** The issues store. */
  issuesManager: Pick<IssuesManager, 'getAll'>;
}

/**
 * Create the catalog handler for `GET /issues`: `{ count, issues }`, keyed by
 * file path or source reference.
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogIssuesHandler(
  deps: CatalogIssuesDeps,
): CatalogHandler<Entry<'issues'>> {
  return () => {
    const issues = deps.issuesManager.getAll();
    // A key without issues would not survive JSON serialisation anyway, so
    // it is neither sent nor counted.
    const present = Object.fromEntries(
      Object.entries(issues).flatMap(([key, records]) =>
        records ? [[key, records] as const] : [],
      ),
    );
    return Promise.resolve({
      status: 200,
      body: { count: Object.keys(present).length, issues: present },
    });
  };
}
