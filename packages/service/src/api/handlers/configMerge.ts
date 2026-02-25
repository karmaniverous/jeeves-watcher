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
