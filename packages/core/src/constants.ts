/**
 * @module constants
 * Shared identity constants for the jeeves-watcher ecosystem.
 * Consumed by both the service and plugin packages.
 */

import { DEFAULT_PORTS } from '@karmaniverous/jeeves';

/** Component name shared across service and plugin descriptors. */
export const COMPONENT_NAME = 'watcher';

/** npm package name for the service. */
export const SERVICE_PACKAGE = '@karmaniverous/jeeves-watcher';

/** npm package name for the plugin. */
export const PLUGIN_PACKAGE = '@karmaniverous/jeeves-watcher-openclaw';

/** npm package name for the core library. */
export const CORE_PACKAGE = '@karmaniverous/jeeves-watcher-core';

/** Default watcher API port. */
export const DEFAULT_PORT = DEFAULT_PORTS.watcher;
