/**
 * @module processor/systemFields
 * Keeps system payload fields authoritative: drops reserved names from rule/enrichment metadata and re-asserts the document's identity fields. Pure.
 */

import { isReservedPayloadField } from '@karmaniverous/jeeves-watcher-core';

import { type DocumentIdentity, identityPayload } from './documentIdentity';

/** Reserved field set by the pipeline itself and carried in rule metadata. */
const FIELD_MATCHED_RULES = 'matched_rules';

/**
 * Prepare metadata for a payload write (upsert or `setPayload`): reserved
 * system names (`file_path`, `source`, `source_rule`, `chunk_text`, …) are
 * removed so no rule property or enrichment can overwrite them, and the
 * identity fields are re-asserted. `matched_rules` is kept: the pipeline
 * itself sets it.
 *
 * @param metadata - Rule and enrichment metadata.
 * @param identity - The document identity.
 * @returns Metadata safe to write, including the identity fields.
 */
export function withSystemFields(
  metadata: Record<string, unknown>,
  identity: DocumentIdentity,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === FIELD_MATCHED_RULES || !isReservedPayloadField(key)) {
      safe[key] = value;
    }
  }
  return { ...safe, ...identityPayload(identity) };
}
