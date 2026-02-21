#!/usr/bin/env node

/**
 * @module cli/jeeves-watcher
 *
 * jeeves-watcher CLI entrypoint.
 */

import { Command } from '@commander-js/extra-typings';

import { startFromConfig } from '../../app';
import { loadConfig } from '../../config';
import { registerConfigReindexCommand } from './commands/configReindex';
import { registerRebuildMetadataCommand } from './commands/rebuildMetadata';
import { registerReindexCommand } from './commands/reindex';
import { registerSearchCommand } from './commands/search';
import { registerServiceCommand } from './commands/service';
import { registerStatusCommand } from './commands/status';
import { writeJsonFile } from './writeJsonFile';

const cli = new Command()
  .name('jeeves-watcher')
  .description(
    'Filesystem watcher that keeps a Qdrant vector store in sync with document changes',
  )
  .version('0.7.0');

const stubAction = (name: string) => () => {
  console.log(`${name}: Not implemented yet`);
};

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
        `  API: ${config.api?.host ?? '127.0.0.1'}:${String(config.api?.port ?? 3456)}`,
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
      const config = {
        $schema:
          'node_modules/@karmaniverous/jeeves-watcher/config.schema.json',
        watch: {
          paths: ['**/*.{md,markdown,txt,text,json,html,htm,pdf,docx}'],
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/.jeeves-watcher/**',
          ],
        },
        configWatch: { enabled: true, debounceMs: 1000 },
        embedding: {
          provider: 'gemini',
          model: 'gemini-embedding-001',
          dimensions: 3072,
        },
        vectorStore: {
          url: 'http://127.0.0.1:6333',
          collectionName: 'jeeves-watcher',
        },
        metadataDir: '.jeeves-watcher',
        api: { host: '127.0.0.1', port: 3456 },
        logging: { level: 'info' },
      };

      await writeJsonFile(options.output, config);
      console.log(`Wrote ${options.output}`);
    } catch (error) {
      console.error('Failed to initialize config:', error);
      process.exit(1);
    }
  });

cli.command('enrich').description('Enrich document metadata').action(stubAction('enrich'));

// API-backed commands
registerStatusCommand(cli);
registerReindexCommand(cli);
registerRebuildMetadataCommand(cli);
registerSearchCommand(cli);
registerConfigReindexCommand(cli);
registerServiceCommand(cli);

cli.parse();
