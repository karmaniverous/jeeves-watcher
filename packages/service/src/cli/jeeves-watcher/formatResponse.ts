/**
 * @module cli/jeeves-watcher/formatResponse
 * Formats API responses for CLI output: pretty-prints JSON when possible, otherwise returns raw text.
 */

/**
 * Format an API response body for console output.
 *
 * @param text - Response body as text.
 * @returns Pretty JSON string if parsable; otherwise the original text.
 */
export function formatResponse(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}
