/**
 * @module processor/systemFields
 * Keeps system payload fields authoritative: drops reserved names from rule/enrichment metadata and re-asserts the document's identity fields (and `matched_rules` when the pipeline supplies it). Pure.
 */

import { isReservedPayloadField } from '@karmaniverous/jeeves-watcher-core';

import { type DocumentIdentity, identityPayload } from './documentIdentity';
import { FIELD_MATCHED_RULES } from './payloadFields';

/**
 * Prepare metadata for a payload write (upsert or `setPayload`): every
 * reserved system name (`file_path`, `source`, `source_rule`, `chunk_text`,
 * `matched_rules`, …) is removed, so no rule property or enrichment can
 * overwrite it, and the identity fields are re-asserted. `matched_rules` is
 * written only from `matchedRules` (the pipeline's own rule matches); a
 * metadata-only write that omits it leaves the stored value untouched.
 *
 * @param metadata - Rule and enrichment metadata.
 * @param identity - The document identity.
 * @param matchedRules - Rules the pipeline applied, when it applied any.
 * @returns Metadata safe to write, including the identity fields.
 */
export function withSystemFields(
  metadata: Record<string, unknown>,
  identity: DocumentIdentity,
  matchedRules?: readonly string[],
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!isReservedPayloadField(key)) safe[key] = value;
  }
  if (matchedRules) safe[FIELD_MATCHED_RULES] = [...matchedRules];
  return { ...safe, ...identityPayload(identity) };
}
