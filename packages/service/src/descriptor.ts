/**
 * @module descriptor
 * Jeeves Component Descriptor for the watcher service. Single source of truth
 * consumed by core factories (CLI, plugin tools, HTTP handlers, service manager).
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from '@commander-js/extra-typings';
import type {
  JeevesComponentDescriptor,
  PluginApi,
  ToolDescriptor,
} from '@karmaniverous/jeeves';

import { mergeInferenceRules } from './api/handlers/configMerge';
import { registerCustomCommands } from './cli/jeeves-watcher/customCommands';
import { INIT_CONFIG_TEMPLATE } from './config/defaults';
import { jeevesWatcherConfigSchema } from './config/schemas';

/**
 * Find the package root by walking up from the current file until we find
 * a `package.json` with our package name. Works in both dev (src/) and
 * bundled (dist/cli/jeeves-watcher/) contexts.
 */
const thisDir = dirname(fileURLToPath(import.meta.url));
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- traversal guard
  while (true) {
    try {
      const pkgPath = resolve(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      if (pkg.name === '@karmaniverous/jeeves-watcher') return dir;
    } catch {
      // not found, keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  throw new Error('Could not find @karmaniverous/jeeves-watcher package root');
}

const packageRoot = findPackageRoot(thisDir);
const require = createRequire(import.meta.url);
const { version } = require(resolve(packageRoot, 'package.json')) as {
  version: string;
};

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
  defaultPort: 1936,

  // Config
  configSchema: jeevesWatcherConfigSchema,
  configFileName: 'config.json',
  initTemplate: () => ({ ...INIT_CONFIG_TEMPLATE }),

  // Service behavior — onConfigApply wired at the Fastify layer (api/index.ts)
  // where it has access to the live reindex tracker and config getter.
  onConfigApply: async (config: Record<string, unknown>) => {
    void config;
    await Promise.resolve();
  },
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
