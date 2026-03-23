/**
 * @module app/initialization
 * Initialization helpers for JeevesWatcher. Extracted to follow SRP.
 */

import { dirname } from 'node:path';

import type { JsonMapMap } from '@karmaniverous/jsonmap';
import type pino from 'pino';

import type { InitialScanTracker } from '../api/InitialScanTracker';
import type { ContentHashCache } from '../cache';
import type { JeevesWatcherConfig } from '../config/types';
import { GitignoreFilter } from '../gitignore';
import { type AllHelpersIntrospection, introspectAllHelpers } from '../helpers';
import type { DocumentProcessorInterface, ProcessorConfig } from '../processor';
import type { EventQueue } from '../queue';
import { loadCustomMapHelpers } from '../rules/apply';
import { buildTemplateEngine, type TemplateEngine } from '../templates';
import { normalizeError } from '../util/normalizeError';
import type { FileSystemWatcher } from '../watcher';
import type { JeevesWatcherFactories } from './factories';

/**
 * Resolve maps config entries to plain JsonMapMap records.
 * Handles string | JsonMapMap | \{ map, description \} union format.
 */
export function resolveMapsConfig(
  maps?: Record<string, unknown>,
): Record<string, JsonMapMap | string> | undefined {
  if (!maps) return undefined;
  const resolved: Record<string, JsonMapMap | string> = {};
  for (const [key, value] of Object.entries(maps)) {
    if (typeof value === 'string') {
      resolved[key] = value;
    } else if (value && typeof value === 'object' && 'map' in value) {
      resolved[key] = (value as { map: JsonMapMap | string }).map;
    } else {
      resolved[key] = value as JsonMapMap;
    }
  }
  return resolved;
}

/**
 * Initialize embedding provider and vector store.
 */
export async function initEmbeddingAndStore(
  config: JeevesWatcherConfig,
  factories: JeevesWatcherFactories,
  logger: pino.Logger,
) {
  let embeddingProvider;
  try {
    embeddingProvider = factories.createEmbeddingProvider(
      config.embedding,
      logger,
    );
  } catch (error) {
    logger.fatal(
      { err: normalizeError(error) },
      'Failed to create embedding provider',
    );
    throw error;
  }

  const vectorStore = factories.createVectorStoreClient(
    config.vectorStore,
    embeddingProvider.dimensions,
    logger,
  );
  await vectorStore.ensureCollection();

  return { embeddingProvider, vectorStore };
}

/**
 * Build template engine and custom map library.
 */
export async function buildTemplateEngineAndCustomMapLib(
  config: JeevesWatcherConfig,
  configDir: string,
): Promise<{
  templateEngine: TemplateEngine | undefined;
  customMapLib: Record<string, (...args: unknown[]) => unknown> | undefined;
}> {
  const templateEngine = await buildTemplateEngine(
    config.inferenceRules ?? [],
    config.templates,
    config.templateHelpers,
    configDir,
  );

  const customMapLib =
    config.mapHelpers && configDir
      ? await loadCustomMapHelpers(config.mapHelpers, configDir)
      : undefined;

  return { templateEngine, customMapLib };
}

/**
 * Create processor configuration from app config.
 */
export function createProcessorConfig(
  config: JeevesWatcherConfig,
  configDir: string,
  customMapLib: Record<string, (...args: unknown[]) => unknown> | undefined,
): ProcessorConfig {
  return {
    chunkSize: config.embedding.chunkSize,
    chunkOverlap: config.embedding.chunkOverlap,
    maps: resolveMapsConfig(config.maps as Record<string, unknown>),
    configDir,
    customMapLib,
    globalSchemas: config.schemas,
  };
}

/**
 * Create file system watcher with gitignore filtering.
 */
export function createWatcher(
  config: JeevesWatcherConfig,
  factories: JeevesWatcherFactories,
  queue: EventQueue,
  processor: DocumentProcessorInterface,
  logger: pino.Logger,
  runtimeOptions: {
    maxRetries?: number;
    maxBackoffMs?: number;
    onFatalError?: (error: unknown) => void;
  },
  initialScanTracker?: InitialScanTracker,
  contentHashCache?: ContentHashCache,
): { watcher: FileSystemWatcher; gitignoreFilter?: GitignoreFilter } {
  const respectGitignore = config.watch.respectGitignore ?? true;
  const gitignoreFilter = respectGitignore
    ? new GitignoreFilter(config.watch.paths)
    : undefined;

  const watcher = factories.createFileSystemWatcher(
    config.watch,
    queue,
    processor,
    logger,
    {
      maxRetries: config.maxRetries ?? runtimeOptions.maxRetries,
      maxBackoffMs: config.maxBackoffMs ?? runtimeOptions.maxBackoffMs,
      onFatalError: runtimeOptions.onFatalError,
      gitignoreFilter,
      initialScanTracker,
      contentHashCache,
    },
  );

  return { watcher, gitignoreFilter };
}

/**
 * Introspect all helpers for merged document.
 */
export async function introspectHelpers(
  config: JeevesWatcherConfig,
  configDir: string,
): Promise<AllHelpersIntrospection> {
  return await introspectAllHelpers(
    {
      mapHelpers: config.mapHelpers,
      templateHelpers: config.templateHelpers,
    },
    configDir,
  );
}

/**
 * Get config directory from config path.
 */
export function getConfigDir(configPath?: string): string {
  return configPath ? dirname(configPath) : '.';
}
