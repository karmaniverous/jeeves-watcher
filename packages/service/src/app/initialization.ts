/**
 * @module app/initialization
 * Initialization helpers for JeevesWatcher. Extracted to follow SRP.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractWatchPathStrings,
  normalizeWatchPaths,
} from '@karmaniverous/jeeves-watcher-core';
import type { JsonMapMap } from '@karmaniverous/jsonmap';
import { packageDirectorySync } from 'package-directory';
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
import {
  checkGitAvailable,
  ensureGitignore,
  initRepo,
  validateStateDirOverlap,
} from '../vcs';
import type { FileSystemWatcher } from '../watcher';
import { globRoot } from '../watcher/globToDir.js';
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
    maps: resolveMapsConfig(config.maps),
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
  onVcsFileChange?: (
    filePath: string,
    event: 'add' | 'change' | 'unlink',
  ) => void,
): { watcher: FileSystemWatcher; gitignoreFilter?: GitignoreFilter } {
  const respectGitignore = config.watch.respectGitignore ?? true;
  const gitignoreFilter = respectGitignore
    ? new GitignoreFilter(extractWatchPathStrings(config.watch.paths))
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
      onVcsFileChange,
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

/** State returned by {@link rebuildWatcher}. */
interface WatcherState {
  watcher: FileSystemWatcher;
  gitignoreFilter?: GitignoreFilter;
}

/**
 * Tear down and rebuild the filesystem watcher with new config.
 * Falls back to the old watcher if the new one fails to start.
 */
export async function rebuildWatcher(
  newConfig: JeevesWatcherConfig,
  factories: JeevesWatcherFactories,
  queue: EventQueue,
  processor: DocumentProcessorInterface,
  logger: pino.Logger,
  runtimeOptions: {
    maxRetries?: number;
    maxBackoffMs?: number;
    onFatalError?: (error: unknown) => void;
  },
  oldState: WatcherState,
  initialScanTracker?: InitialScanTracker,
  contentHashCache?: ContentHashCache,
): Promise<WatcherState> {
  try {
    await oldState.watcher.stop();

    const { watcher: newWatcher, gitignoreFilter: newGitignoreFilter } =
      createWatcher(
        newConfig,
        factories,
        queue,
        processor,
        logger,
        runtimeOptions,
        initialScanTracker,
        contentHashCache,
      );
    newWatcher.start();
    logger.info('Filesystem watcher rebuilt successfully');
    return { watcher: newWatcher, gitignoreFilter: newGitignoreFilter };
  } catch (error) {
    logger.error(
      { err: normalizeError(error) },
      'Failed to rebuild watcher, restoring previous',
    );

    try {
      oldState.watcher.start();
    } catch (restartError) {
      logger.error(
        { err: normalizeError(restartError) },
        'Failed to restart previous watcher',
      );
    }
    return oldState;
  }
}

/**
 * Check whether watch-relevant config fields changed between old and new config.
 */
export function watchConfigChanged(
  oldConfig: JeevesWatcherConfig,
  newConfig: JeevesWatcherConfig,
): boolean {
  return (
    JSON.stringify(oldConfig.watch.paths) !==
      JSON.stringify(newConfig.watch.paths) ||
    JSON.stringify(oldConfig.watch.ignored) !==
      JSON.stringify(newConfig.watch.ignored) ||
    JSON.stringify(oldConfig.watch.moveDetection) !==
      JSON.stringify(newConfig.watch.moveDetection) ||
    (oldConfig.watch.respectGitignore ?? true) !==
      (newConfig.watch.respectGitignore ?? true)
  );
}

/**
 * Resolve package version from nearest package.json.
 */
export function resolveVersion(referenceUrl: string): string {
  try {
    const pkgDir = packageDirectorySync({
      cwd: dirname(fileURLToPath(referenceUrl)),
    });
    const pkg = pkgDir
      ? (JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
          version: string;
        })
      : undefined;
    return pkg?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Initialize VCS for all watch roots where VCS is enabled.
 * Checks git availability, validates stateDir overlap, and initializes repos.
 *
 * @param config - The resolved configuration (mutated in place if git unavailable).
 * @param logger - Logger instance.
 * @returns The effective VCS enabled state (false if git unavailable).
 */
export async function initVcs(
  config: JeevesWatcherConfig,
  logger: pino.Logger,
): Promise<boolean> {
  if (!config.vcs?.enabled) return false;

  const gitAvailable = await checkGitAvailable();
  if (!gitAvailable) {
    logger.warn('git not found on PATH — VCS disabled for this session');
    return false;
  }

  const stateDir = config.stateDir ?? '.jeeves-metadata';
  const pathStrings = extractWatchPathStrings(config.watch.paths);
  const staticPaths = pathStrings.map((p) => globRoot(p));
  validateStateDirOverlap(stateDir, staticPaths);

  const normalized = normalizeWatchPaths(config.watch.paths);
  const initializedRoots = new Set<string>();
  for (const entry of normalized) {
    const rootVcs = entry.vcs?.enabled ?? config.vcs.enabled;
    if (!rootVcs) continue;

    const root = globRoot(entry.path);

    // Deduplicate: skip if another glob already resolved to this root.
    if (initializedRoots.has(root)) continue;
    initializedRoots.add(root);

    await initRepo(root);
    await ensureGitignore(root);
    logger.info({ root }, 'VCS initialized for watch root');
  }

  return true;
}
