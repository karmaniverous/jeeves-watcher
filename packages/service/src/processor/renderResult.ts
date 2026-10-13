/**
 * @module processor/renderResult
 * The render endpoint result and its one constructor from a resolved document (file or source). Pure, no I/O.
 */

import type { ResolvedDocument } from './resolvers/types';

/**
 * Result returned by {@link DocumentProcessorInterface.renderFile}.
 */
export interface RenderResult {
  /** Output content type (file extension without dot). Always present. */
  renderAs: string;
  /** Rendered content (if a transform ran) or extracted text (passthrough). */
  content: string;
  /** Names of matched inference rules (diagnostic). */
  rules: string[];
  /** Composed embedding properties from matched rules. */
  metadata: Record<string, unknown>;
  /** Whether a template or render transform produced the content. */
  transformed: boolean;
}

/**
 * The render result of a resolved document (nothing embedded or written).
 *
 * @param document - The resolved file or source document.
 * @returns Its text, content type, matched rules and metadata.
 */
export function toRenderResult(document: ResolvedDocument): RenderResult {
  return {
    renderAs: document.renderAs,
    content: document.text,
    rules: document.matchedRules,
    metadata: document.metadataWithRules,
    transformed: document.transformed,
  };
}
