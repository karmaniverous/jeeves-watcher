/**
 * @module api/handlers/issues
 * Fastify route handler for GET /issues. Returns current processing issues.
 */

import type { IssuesManager } from '../../issues';

/** Dependencies for the issues route handler. */
export interface IssuesRouteDeps {
  issuesManager: IssuesManager;
}

/**
 * Create handler for GET /issues.
 *
 * @param deps - Route dependencies.
 */
export function createIssuesHandler(deps: IssuesRouteDeps) {
  return () => {
    return deps.issuesManager.getAll();
  };
}
