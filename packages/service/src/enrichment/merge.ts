/**
 * @module enrichment/merge
 * Composable merge for inferred + enrichment metadata. Scalars: enrichment overwrites. Arrays: union + deduplicate. No I/O.
 */

/**
 * Merge enrichment metadata into inferred metadata with composable semantics.
 *
 * - Scalar fields: enrichment value overwrites inferred value.
 * - Array fields: union merge with deduplication (enrichment values appended).
 *
 * @param inferred - Metadata derived from inference rules.
 * @param enrichment - Human/agent-provided enrichment metadata.
 * @returns Merged metadata.
 */
export function mergeEnrichment(
  inferred: Record<string, unknown>,
  enrichment: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...inferred };

  for (const [key, enrichValue] of Object.entries(enrichment)) {
    const inferredValue = result[key];

    if (Array.isArray(inferredValue) && Array.isArray(enrichValue)) {
      const combined = [
        ...(inferredValue as unknown[]),
        ...(enrichValue as unknown[]),
      ];
      result[key] = [...new Set(combined)];
    } else {
      result[key] = enrichValue;
    }
  }

  return result;
}
