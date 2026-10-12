/**
 * @module issues/types
 * Issue record schema and types for the issues tracking system. IssueRecord is defined in core (GET /issues response); IssuesFile is the on-disk shape.
 */

import type { IssueRecord } from '@karmaniverous/jeeves-watcher-core';

export {
  type IssueRecord,
  issueRecordSchema,
} from '@karmaniverous/jeeves-watcher-core';

/** Issues file: array of issue records per file path. */
export type IssuesFile = Partial<Record<string, IssueRecord[]>>;
