/**
 * @module plugin/watcherComponent
 * Jeeves component descriptor for the watcher OpenClaw plugin.
 *
 * @remarks
 * Uses `createAsyncContentCache()` from core to bridge the sync/async gap:
 * `generateToolsContent()` must be synchronous, but the watcher menu requires
 * async HTTP calls. The cache triggers a background refresh on each call and
 * returns the most recent successful result.
 */

import {
  createAsyncContentCache,
  type JeevesComponentDescriptor,
  jeevesComponentDescriptorSchema,
} from '@karmaniverous/jeeves';

import { PLUGIN_ID } from './constants.js';
import { generateWatcherMenu } from './promptInjection.js';

/** Options for creating the watcher component descriptor. */
interface CreateWatcherComponentOptions {
  /** Base URL of the jeeves-watcher HTTP API. */
  apiUrl: string;
  /** Plugin package version. */
  pluginVersion: string;
}

/**
 * Create the watcher component descriptor.
 *
 * @remarks
 * Returns a `JeevesComponentDescriptor` conforming to the core Zod schema,
 * ready for `createComponentWriter()`. Phase 3/4 will wire the placeholder
 * fields (`onConfigApply`, `customCliCommands`, `customPluginTools`) to
 * real implementations.
 *
 * @param options - API URL and plugin version.
 * @returns A validated component descriptor.
 */
export function createWatcherComponent(
  options: CreateWatcherComponentOptions,
): JeevesComponentDescriptor {
  const { apiUrl, pluginVersion } = options;

  const getContent = createAsyncContentCache({
    fetch: async () => generateWatcherMenu(apiUrl),
    placeholder: '> Initializing watcher menu...',
  });

  return {
    name: 'watcher',
    version: pluginVersion,
    servicePackage: '@karmaniverous/jeeves-watcher',
    pluginPackage: `@karmaniverous/${PLUGIN_ID}`,
    defaultPort: 1936,
    // Transitional placeholder: ComponentWriter needs a Zod schema but
    // does not consume it beyond validation in Phase 2. The real watcher
    // config schema will be wired in Phase 3 via the service descriptor.
    configSchema: jeevesComponentDescriptorSchema.shape.name,
    configFileName: 'config.json',
    initTemplate: () => ({}),
    startCommand: (configPath: string) => [
      'jeeves-watcher',
      'start',
      '-c',
      configPath,
    ],
    sectionId: 'Watcher',
    refreshIntervalSeconds: 71,
    generateToolsContent: getContent,
  };
}
