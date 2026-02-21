/**
 * @module util/errors
 * Error normalization utility. Converts unknown caught values to proper Error instances for consistent logging.
 */

/**
 * Normalize an unknown error value into an Error instance.
 *
 * @param error - The caught error value.
 * @returns An Error instance.
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}
