/**
 * @module util/normalizeError
 *
 * Normalizes unknown thrown values into proper Error objects for pino serialization.
 */

/**
 * Convert an unknown thrown value into a proper Error with message, stack, and cause.
 * Pino's built-in `err` serializer requires an Error instance to extract message/stack.
 *
 * @param error - The caught value (may not be an Error).
 * @returns A proper Error instance.
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;

  if (typeof error === 'string') return new Error(error);

  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as Record<string, unknown>).message)
      : String(error);

  const normalized = new Error(message);
  normalized.cause = error;
  return normalized;
}
