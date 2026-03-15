/**
 * @module api/handlers/issues
 * Fastify route handler for GET /issues. Returns current processing issues.
 */

import type { IssuesManager } from '../../issues';

/** Dependencies for the issues route handler. */
interface IssuesRouteDeps {
  issuesManager: IssuesManager;
}

/**
 * Create handler for GET /issues.
 *
 * @param deps - Route dependencies.
 */
export function createIssuesHandler(deps: IssuesRouteDeps) {
  return () => {
    const issues = deps.issuesManager.getAll();
    return {
      count: Object.keys(issues).length,
      issues,
    };
  };
}
