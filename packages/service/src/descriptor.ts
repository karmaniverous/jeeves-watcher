/**
 * @module descriptor
 * Jeeves Component Descriptor for the watcher service. Single source of truth
 * consumed by core factories (CLI, plugin tools, HTTP handlers, service manager).
 */

import { createRequire } from 'node:module';
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

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

/**
 * Watcher component descriptor.
 *
 * Placeholders for `onConfigApply`, `generateToolsContent`, `customCliCommands`,
 * and `customPluginTools` are populated in Phase 3 (service) and Phase 4 (plugin).
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

  // Service behavior
  onConfigApply: async (config: Record<string, unknown>) => {
    void config;
    await Promise.resolve();
    // Phase 3: wire to triggerReindex(configWatch.reindex scope)
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
    fileURLToPath(new URL('./cli/jeeves-watcher/index.js', import.meta.url)),
    'start',
    '-c',
    configPath,
  ],

  // Content
  sectionId: 'Watcher',
  refreshIntervalSeconds: 71,
  generateToolsContent: () => '',
  // Phase 4: wire to generateWatcherMenu()

  // Extension points
  customCliCommands: (program: Command) => {
    registerCustomCommands(program);
  },
  customPluginTools: (api: PluginApi): ToolDescriptor[] => {
    void api;
    // Phase 4: return tool descriptors for domain-specific tools
    return [];
  },
};
