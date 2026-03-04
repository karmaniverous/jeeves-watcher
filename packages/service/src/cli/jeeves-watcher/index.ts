/**
 * @module cli/jeeves-watcher
 *
 * jeeves-watcher CLI entrypoint.
 */

import { createRequire } from 'node:module';

import { Command } from '@commander-js/extra-typings';

import { startFromConfig } from '../../app';
import { loadConfig } from '../../config';
import { INIT_CONFIG_TEMPLATE } from '../../config/defaults';
import { registerConfigApplyCommand } from './commands/configApply';
import { registerConfigReindexCommand } from './commands/configReindex';
import { registerEnrichCommand } from './commands/enrich';
import { registerHelpersCommand } from './commands/helpers';
import { registerIssuesCommand } from './commands/issues';
import { registerQueryCommand } from './commands/query';
import { registerRebuildMetadataCommand } from './commands/rebuildMetadata';
import { registerReindexCommand } from './commands/reindex';
import { registerSearchCommand } from './commands/search';
import { registerServiceCommand } from './commands/service';
import { registerStatusCommand } from './commands/status';
import { writeJsonFile } from './writeJsonFile';

const require = createRequire(import.meta.url);
const { version } = require('../../../package.json') as { version: string };

const cli = new Command()
  .name('jeeves-watcher')
  .description(
    'Filesystem watcher that keeps a Qdrant vector store in sync with document changes',
  )
  .version(version);

cli
  .command('start')
  .description('Start the filesystem watcher')
  .option('-c, --config <path>', 'Path to configuration file')
  .action(async (options) => {
    try {
      await startFromConfig(options.config);
    } catch (error) {
      console.error('Failed to start:', error);
      process.exit(1);
    }
  });

cli
  .command('validate')
  .description('Validate the configuration')
  .option('-c, --config <path>', 'Path to configuration file')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      console.log('Config valid');
      console.log(`  Watch paths: ${config.watch.paths.join(', ')}`);
      console.log(
        `  Embedding: ${config.embedding.provider}/${config.embedding.model}`,
      );
      console.log(
        `  Vector store: ${config.vectorStore.url} (${config.vectorStore.collectionName})`,
      );
      console.log(
        `  API: ${config.api?.host ?? '127.0.0.1'}:${String(config.api?.port ?? 1936)}`,
      );
    } catch (error) {
      console.error('Config invalid:', error);
      process.exit(1);
    }
  });

cli
  .command('init')
  .description('Initialize a new configuration (jeeves-watcher.config.json)')
  .option(
    '-o, --output <path>',
    'Output config file path',
    'jeeves-watcher.config.json',
  )
  .action(async (options) => {
    try {
      await writeJsonFile(options.output, INIT_CONFIG_TEMPLATE);
      console.log(`Wrote ${options.output}`);
    } catch (error) {
      console.error('Failed to initialize config:', error);
      process.exit(1);
    }
  });

// API-backed commands
registerStatusCommand(cli);
registerReindexCommand(cli);
registerRebuildMetadataCommand(cli);
registerSearchCommand(cli);
registerEnrichCommand(cli);
registerConfigReindexCommand(cli);
registerServiceCommand(cli);
registerQueryCommand(cli);
registerIssuesCommand(cli);
registerHelpersCommand(cli);
registerConfigApplyCommand(cli);

cli.parse();
