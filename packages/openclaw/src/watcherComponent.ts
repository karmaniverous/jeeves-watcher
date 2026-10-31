/**
 * @module plugin/watcherComponent
 * Jeeves component descriptor for the watcher OpenClaw plugin.
 *
 * @remarks
 * Feeds `createPluginToolset()` (with `WATCHER_CATALOG`, `catalogTools.ts`),
 * which builds the four standard tools and the catalog-built domain tools.
 * The service descriptor
 * (`packages/service/src/descriptor.ts`) is the canonical source for the
 * config schema and CLI commands.
 */

import {
  type JeevesComponentDescriptor,
  jeevesComponentDescriptorSchema,
} from '@karmaniverous/jeeves';
import {
  WATCHER_PROMPT_RULES,
  WATCHER_SKILL,
} from '@karmaniverous/jeeves-watcher-core';

import {
  COMPONENT_NAME,
  DEFAULT_PORT,
  PLUGIN_PACKAGE,
  SERVICE_PACKAGE,
} from './constants.js';

/**
 * Create the watcher component descriptor.
 *
 * @param pluginVersion - Plugin package version.
 * @returns A component descriptor conforming to the core Zod schema.
 */
export function createWatcherComponent(
  pluginVersion: string,
): JeevesComponentDescriptor {
  return {
    name: COMPONENT_NAME,
    version: pluginVersion,
    servicePackage: SERVICE_PACKAGE,
    pluginPackage: PLUGIN_PACKAGE,
    defaultPort: DEFAULT_PORT,
    // Placeholder: the toolset does not consume the config schema. The real
    // watcher config schema lives in the service descriptor.
    configSchema: jeevesComponentDescriptorSchema.shape.name,
    configFileName: 'config.json',
    initTemplate: () => ({}),
    // Injected by the plugin (prompt rules) and written by its build (skill).
    promptRules: WATCHER_PROMPT_RULES,
    skill: WATCHER_SKILL,
    startCommand: (configPath: string) => [
      'jeeves-watcher',
      'start',
      '-c',
      configPath,
    ],
    // The real run callback lives in the service descriptor.
    run: () => {
      return Promise.reject(
        new Error('run() is not available on the plugin-side descriptor'),
      );
    },
  };
}
