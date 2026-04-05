/**
 * @module descriptor
 * Jeeves Component Descriptor for the watcher service. Single source of truth
 * consumed by core factories (CLI, plugin tools, HTTP handlers, service manager).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from '@commander-js/extra-typings';
import {
  DEFAULT_PORTS,
  getPackageVersion,
  type JeevesComponentDescriptor,
  type PluginApi,
  type ToolDescriptor,
} from '@karmaniverous/jeeves';
import { packageDirectorySync } from 'package-directory';

import { mergeInferenceRules } from './api/handlers/configMerge';
import { startFromConfig } from './app/startFromConfig';
import { registerCustomCommands } from './cli/jeeves-watcher/customCommands';
import { INIT_CONFIG_TEMPLATE } from './config/defaults';
import { jeevesWatcherConfigSchema } from './config/schemas';

/**
 * Resolve the package root directory using `package-directory`.
 *
 * @remarks
 * Works in both dev (`src/descriptor.ts`) and bundled
 * (`dist/cli/jeeves-watcher/index.js`) contexts because
 * `packageDirectorySync` walks upward to find `package.json`.
 */
const thisDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = packageDirectorySync({ cwd: thisDir });
if (!packageRoot) {
  throw new Error('Could not find package root from ' + thisDir);
}

const version = getPackageVersion(import.meta.url);

/**
 * Watcher component descriptor. Single source of truth for service identity,
 * config schema, and extension points consumed by core factories.
 */
export const watcherDescriptor: JeevesComponentDescriptor = {
  // Identity
  name: 'watcher',
  version,
  servicePackage: '@karmaniverous/jeeves-watcher',
  pluginPackage: '@karmaniverous/jeeves-watcher-openclaw',
  defaultPort: DEFAULT_PORTS.watcher,

  // Config
  configSchema: jeevesWatcherConfigSchema,
  configFileName: 'config.json',
  initTemplate: () => ({ ...INIT_CONFIG_TEMPLATE }),

  // onConfigApply is overridden in createApiServer (api/index.ts) via the
  // descriptor passed as a dependency, where it has access to the live
  // reindex tracker and config getter.
  customMerge: (
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): Record<string, unknown> => {
    const mergedRules = mergeInferenceRules(
      target['inferenceRules'] as Record<string, unknown>[] | undefined,
      source['inferenceRules'] as Record<string, unknown>[] | undefined,
    );
    return {
      ...target,
      ...source,
      inferenceRules: mergedRules,
    };
  },
  startCommand: (configPath: string) => [
    'node',
    resolve(packageRoot, 'dist/cli/jeeves-watcher/index.js'),
    'start',
    '-c',
    configPath,
  ],
  run: async (configPath: string) => {
    await startFromConfig(configPath, watcherDescriptor);
  },

  // Content — generateToolsContent is wired in the plugin package
  // (watcherComponent.ts) where it has access to the API URL for menu generation.
  sectionId: 'Watcher',
  refreshIntervalSeconds: 71,
  generateToolsContent: () => '',

  // Extension points
  customCliCommands: (program: Command) => {
    registerCustomCommands(program);
  },
  customPluginTools: (api: PluginApi): ToolDescriptor[] => {
    void api;
    return [];
  },
};
