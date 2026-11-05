/**
 * @module catalog/destructiveEntries
 * The watcher catalog's `destructive` entries, in catalog order (spec Design 3 kinds). No I/O.
 */

import {
  documentsDeleteRequestSchema,
  documentsDeleteResponseSchema,
  pointsDeleteRequestSchema,
  pointsDeleteResponseSchema,
  rulesUnregisterParamsSchema,
  rulesUnregisterRequestSchema,
  rulesUnregisterResponseSchema,
  VCS_EXCLUDE_CONFIRM_THRESHOLD,
  vcsExcludeRequestSchema,
  vcsExcludeResponseSchema,
  vcsRevertRequestSchema,
  vcsRevertResponseSchema,
} from '../api/index.js';
import { route, vcsRoute } from './routes.js';

/** The `destructive` entries. */
export const DESTRUCTIVE_ENTRIES = [
  {
    ...route(
      'deleteDocuments',
      'POST',
      '/documents/delete',
      'Delete source documents by reference or by Qdrant filter (at least one condition; constrained to points carrying source and no file_path). The route waits at most 10 s for each document lock; if one stays busy it answers 503 `not_available` with `Retry-After: 10`, and documents already deleted stay deleted (retry to finish).',
    ),
    body: documentsDeleteRequestSchema,
    response: documentsDeleteResponseSchema,
    kind: 'destructive',
  },
  {
    ...route(
      'deletePoints',
      'POST',
      '/points/delete',
      'Delete points from the vector store by filter.',
    ),
    body: pointsDeleteRequestSchema,
    response: pointsDeleteResponseSchema,
    kind: 'destructive',
  },
  {
    ...route(
      'unregisterRules',
      'DELETE',
      '/rules/unregister',
      'Unregister external inference rules.',
    ),
    body: rulesUnregisterRequestSchema,
    response: rulesUnregisterResponseSchema,
    kind: 'destructive',
  },
  {
    ...route(
      'unregisterRulesBySource',
      'DELETE',
      '/rules/unregister/:source',
      'Unregister all external inference rules from a source.',
    ),
    params: rulesUnregisterParamsSchema,
    response: rulesUnregisterResponseSchema,
    kind: 'destructive',
  },
  {
    ...vcsRoute(
      'revertVcs',
      'POST',
      '/vcs/revert',
      'Restore files from a historical commit (forward-only reversion).',
    ),
    body: vcsRevertRequestSchema,
    response: vcsRevertResponseSchema,
    kind: 'destructive',
  },
  {
    // D103: it untracks files, ending their history.
    ...vcsRoute(
      'excludeVcsPath',
      'POST',
      '/vcs/exclude',
      'Exclude a path from version history (VCS-only: it stays in search) or remove the exclusion. The glob is a gitignore pattern, so brackets are a character class: escape them to name a file literally (`Report \\[draft\\].docx`). Adding a pattern also untracks the tracked files it matches, in one commit (history stops for them; the files stay on disk and in search); `remove` does not restore that history. More than ' +
        String(VCS_EXCLUDE_CONFIRM_THRESHOLD) +
        " files to untrack need `confirm: true` (else 409 `confirm_required` with `untracked`, nothing written). The route waits at most 30 s for the root's git lock, then answers 503 `not_available` with `Retry-After: 30`, nothing written. A glob outside an explicit `root` is 400; a glob under no VCS root is 404.",
    ),
    body: vcsExcludeRequestSchema,
    response: vcsExcludeResponseSchema,
    kind: 'destructive',
  },
] as const;
