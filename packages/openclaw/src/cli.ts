/**
 * CLI for installing/uninstalling the jeeves-watcher OpenClaw plugin.
 *
 * Usage:
 *   npx \@karmaniverous/jeeves-watcher-openclaw install
 *   npx \@karmaniverous/jeeves-watcher-openclaw uninstall
 *
 * @module cli
 */

import { createPluginCli } from '@karmaniverous/jeeves';

import { PLUGIN_ID } from './constants.js';

const program = createPluginCli({
  pluginId: PLUGIN_ID,
  importMetaUrl: import.meta.url,
  pluginPackage: '@karmaniverous/jeeves-watcher-openclaw',
  componentName: 'watcher',
});

program.parse();
