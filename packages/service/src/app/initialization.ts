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
  vcsAuthorConfigSchema,
} from '@karmaniverous/jeeves-watcher-core';
import type { JsonMapMap } from '@karmaniverous/jsonmap';
import { packageDirectorySync } from 'package-directory';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { type AllHelpersIntrospection, introspectAllHelpers } from '../helpers';
import type { ProcessorConfig } from '../processor';
import { loadCustomMapHelpers } from '../rules/apply';
import { buildTemplateEngine, type TemplateEngine } from '../templates';
import { normalizeError } from '../util/normalizeError';
import {
  checkGitAvailable,
  configureRepoIdentity,
  ensureGitignore,
  initRepo,
  validateStateDirOverlap,
} from '../vcs';
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

// createWatcher, rebuildWatcher, and watchConfigChanged have been moved to watcherFactory.ts.
// Re-exported here for backward compatibility.
export {
  createWatcher,
  rebuildWatcher,
  watchConfigChanged,
  type WatcherState,
} from './watcherFactory';

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

    // Resolve author identity: per-path → root-level → schema defaults.
    const defaults = vcsAuthorConfigSchema.parse({});
    const pathAuthor = entry.vcs?.author;
    const rootAuthor = config.vcs.author;
    const authorName = pathAuthor?.name ?? rootAuthor?.name ?? defaults.name;
    const authorEmail =
      pathAuthor?.email ?? rootAuthor?.email ?? defaults.email;
    await configureRepoIdentity(root, authorName, authorEmail);

    logger.info({ root }, 'VCS initialized for watch root');
    logger.debug(
      { root, authorName, authorEmail },
      'VCS author identity configured',
    );
  }

  return true;
}
