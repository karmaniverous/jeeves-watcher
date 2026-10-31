/**
 * @module api/vcs
 * Zod request schemas for the version-history endpoints in the endpoint catalog (`GET /vcs/show`). No I/O.
 */

import { z } from 'zod';

/**
 * A required, non-empty query parameter whose missing or empty value is
 * reported as `Missing required query parameter: <name>` (a schema-level
 * `error` also words the schema's own checks, here `min(1)`).
 *
 * @param name - Parameter name.
 * @param description - Parameter description (OpenAPI and tool text).
 * @returns The parameter schema.
 */
function requiredQueryParam(name: string, description: string) {
  const error = `Missing required query parameter: ${name}`;
  return z.string({ error }).min(1).describe(description);
}

/** Query string of `GET /vcs/show`. */
export const vcsShowQuerySchema = z.object({
  /** Absolute path of the file inside a VCS-enabled watch root. */
  path: requiredQueryParam('path', 'File path to retrieve.'),
  /** Version identifier (a commit). */
  commit: requiredQueryParam('commit', 'Version identifier.'),
});

/** Query string of `GET /vcs/show`. */
export type VcsShowQuery = z.infer<typeof vcsShowQuerySchema>;
