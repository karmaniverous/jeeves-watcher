/**
 * @module cli/jeeves-watcher/runApiCommand
 * Shared CLI wrapper for calling the jeeves-watcher API and printing formatted output with consistent error handling.
 */

import { apiCall } from './api';
import { formatResponse } from './formatResponse';

export interface RunApiCommandOptions {
  host: string;
  port: string;
  method: string;
  path: string;
  body?: unknown;
  /** Optional user-facing message when the API call fails. */
  failureMessage?: string;
}

/**
 * Call the API and print a formatted response. Exits the process with code 1 on failure.
 *
 * @param options - API call options.
 */
export async function runApiCommand(options: RunApiCommandOptions): Promise<void> {
  try {
    const text = await apiCall(
      options.host,
      options.port,
      options.method,
      options.path,
      options.body,
    );
    console.log(formatResponse(text));
  } catch (error) {
    if (options.failureMessage) {
      console.error(options.failureMessage);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}
