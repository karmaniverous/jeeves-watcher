#!/usr/bin/env node

import { Command } from '@commander-js/extra-typings';

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
  .action(stubAction('start'));

cli
  .command('init')
  .description('Initialize a new configuration')
  .action(stubAction('init'));

cli
  .command('status')
  .description('Show watcher status')
  .action(stubAction('status'));

cli
  .command('reindex')
  .description('Reindex all watched files')
  .action(stubAction('reindex'));

cli
  .command('rebuild-metadata')
  .description('Rebuild metadata for all watched files')
  .action(stubAction('rebuild-metadata'));

cli
  .command('search')
  .description('Search the vector store')
  .action(stubAction('search'));

cli
  .command('enrich')
  .description('Enrich document metadata')
  .action(stubAction('enrich'));

cli
  .command('validate')
  .description('Validate the configuration')
  .action(stubAction('validate'));

cli
  .command('service')
  .description('Manage the watcher as a system service')
  .action(stubAction('service'));

cli
  .command('config-reindex')
  .description('Reindex configuration files')
  .action(stubAction('config-reindex'));

cli.parse();
