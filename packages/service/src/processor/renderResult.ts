/**
 * @module processor/renderResult
 * Type definition for the render endpoint result.
 */

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
