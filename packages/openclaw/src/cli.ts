/**
 * CLI for installing/uninstalling the jeeves-watcher OpenClaw plugin.
 *
 * Usage:
 *   npx \@karmaniverous/jeeves-watcher-openclaw install
 *   npx \@karmaniverous/jeeves-watcher-openclaw uninstall
 *
 * @module cli
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPluginCli } from '@karmaniverous/jeeves';

import { PLUGIN_ID } from './constants.js';

const thisFile = fileURLToPath(import.meta.url);
const distDir = resolve(thisFile, '../..');

const program = createPluginCli({
  pluginId: PLUGIN_ID,
  distDir,
  pluginPackage: '@karmaniverous/jeeves-watcher-openclaw',
  componentName: 'watcher',
});

program.parse();
