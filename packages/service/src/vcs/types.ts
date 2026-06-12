/**
 * @module vcs/types
 * Shared types for the VCS subsystem.
 */

/** Metadata for a pending reversion to include in the commit message. */
export interface PendingReversion {
  glob: string;
  commit: string;
  paths: string[];
}

/** Push error record for status reporting. */
export interface PushError {
  timestamp: string;
  message: string;
}
