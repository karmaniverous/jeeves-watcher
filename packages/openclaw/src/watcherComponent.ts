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

import {
  COMPONENT_NAME,
  DEFAULT_PORT,
  PLUGIN_PACKAGE,
  SERVICE_PACKAGE,
} from './constants.js';
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
 * ready for `createComponentWriter()`. The service descriptor
 * (`packages/service/src/descriptor.ts`) is the canonical source for
 * config schema and CLI commands; this plugin-side descriptor carries only
 * the fields `ComponentWriter` needs (identity, content generation).
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
    name: COMPONENT_NAME,
    version: pluginVersion,
    servicePackage: SERVICE_PACKAGE,
    pluginPackage: PLUGIN_PACKAGE,
    defaultPort: DEFAULT_PORT,
    // Transitional placeholder: ComponentWriter needs a Zod schema but
    // does not consume it beyond validation. The real watcher config
    // schema lives in the service descriptor.
    configSchema: jeevesComponentDescriptorSchema.shape.name,
    configFileName: 'config.json',
    initTemplate: () => ({}),
    startCommand: (configPath: string) => [
      'jeeves-watcher',
      'start',
      '-c',
      configPath,
    ],
    // Plugin-side descriptor is only used by ComponentWriter for managed
    // content. The real run callback lives in the service descriptor.
    run: () => {
      return Promise.reject(
        new Error('run() is not available on the plugin-side descriptor'),
      );
    },
    sectionId: 'Watcher',
    refreshIntervalSeconds: 71,
    generateToolsContent: getContent,
  };
}
