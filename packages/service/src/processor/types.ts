/**
 * @module processor/types
 * Document processor interface definitions.
 */

import type { CompiledRule } from '../rules';
import type { TemplateEngine } from '../templates';
import type { RenderResult } from './renderResult';
import type { SourceOperationsProvider } from './SourceOperations';

/**
 * Abstraction for document processing operations.
 *
 * Enables factories and consumers to depend on an interface (DIP).
 */
export interface DocumentProcessorInterface {
  /** Process a file through the full pipeline (extract/embed/upsert). */
  processFile(filePath: string): Promise<void>;

  /** Delete a file's points/metadata from the system. */
  deleteFile(filePath: string): Promise<void>;

  /** Process a metadata sidecar update for a file (payload update only). */
  processMetadataUpdate(
    filePath: string,
    metadata: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;

  /** Process a rules update for a file (rebuild merged metadata, payload update only). */
  processRulesUpdate(filePath: string): Promise<Record<string, unknown> | null>;

  /** Render a file through the rule engine without embedding. */
  renderFile(filePath: string): Promise<RenderResult>;

  /** Move a file's vector points and metadata from old path to new path (no re-embed). */
  moveFile(oldPath: string, newPath: string): Promise<void>;

  /** Update compiled inference rules and associated engines. */
  updateRules(
    compiledRules: CompiledRule[],
    templateEngine?: TemplateEngine,
    customMapLib?: Record<string, (...args: unknown[]) => unknown>,
  ): void;
}

/**
 * The processor the service runs on: file operations plus source operations.
 * `createDocumentProcessor` returns it; the API server and the notify queue
 * depend on it (`DocumentProcessor` implements it). Adapt a custom file-only
 * processor with `withoutSourceSupport`, whose source operations fail.
 */
export type WatcherProcessor = DocumentProcessorInterface &
  SourceOperationsProvider;
