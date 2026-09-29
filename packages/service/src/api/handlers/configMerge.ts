/**
 * @module api/handlers/configMerge
 * Shared config merge utilities.
 */

/** A validation error entry. */
export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Check whether a value is a plain object (not null, not an array).
 *
 * @param value - Value to check.
 * @returns True for plain objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge a config patch into a base config.
 *
 * @remarks
 * Plain objects are merged recursively; arrays and scalars in the patch
 * replace the base value. `inferenceRules` is merged by rule name (see
 * {@link mergeInferenceRules}). Neither input is mutated.
 *
 * @param base - The current config.
 * @param patch - The partial config to apply.
 * @returns A new merged config.
 */
export function deepMergeConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = base[key];
    if (key === 'inferenceRules' && Array.isArray(value)) {
      result[key] = mergeInferenceRules(
        Array.isArray(current)
          ? (current as Record<string, unknown>[])
          : undefined,
        value as Record<string, unknown>[],
      );
    } else if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMergeConfig(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Merge inference rules by name: submitted rules replace existing by name, new ones are appended.
 */
export function mergeInferenceRules(
  existing: Record<string, unknown>[] | undefined,
  incoming: Record<string, unknown>[] | undefined,
): Record<string, unknown>[] {
  if (!incoming) return existing ?? [];
  if (!existing) return incoming;

  const merged = [...existing];
  for (const rule of incoming) {
    const name = rule['name'] as string | undefined;
    if (!name) {
      merged.push(rule);
      continue;
    }
    const idx = merged.findIndex((r) => r['name'] === name);
    if (idx >= 0) {
      merged[idx] = rule;
    } else {
      merged.push(rule);
    }
  }
  return merged;
}
