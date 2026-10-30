/**
 * @module api/vcs
 * Zod request schemas for the version-history endpoints in the endpoint catalog (`GET /vcs/show`). No I/O.
 */

import { z } from 'zod';

/** Query string of `GET /vcs/show`. */
export const vcsShowQuerySchema = z.object({
  /** Absolute path of the file inside a VCS-enabled watch root. */
  path: z
    .string({ error: 'Missing required query parameter: path' })
    .min(1, { error: 'Missing required query parameter: path' })
    .describe('File path to retrieve.'),
  /** Version identifier (a commit). */
  commit: z
    .string({ error: 'Missing required query parameter: commit' })
    .min(1, { error: 'Missing required query parameter: commit' })
    .describe('Version identifier.'),
});

/** Query string of `GET /vcs/show`. */
export type VcsShowQuery = z.infer<typeof vcsShowQuerySchema>;
