#!/usr/bin/env node

import { Command } from '@commander-js/extra-typings';

import { startFromConfig } from '../../app';
import { loadConfig } from '../../config';

const cli = new Command()
  .name('jeeves-watcher')
  .description(
    'Filesystem watcher that keeps a Qdrant vector store in sync with document changes',
  )
  .version('0.7.0');

function apiBase(host: string, port: string): string {
  return `http://${host}:${port}`;
}

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
        `  API: ${config.api?.host ?? '127.0.0.1'}:${String(config.api?.port ?? 3458)}`,
      );
    } catch (error) {
      console.error('Config invalid:', error);
      process.exit(1);
    }
  });

cli
  .command('status')
  .description('Show watcher status')
  .option('-p, --port <port>', 'API port', '3458')
  .option('-H, --host <host>', 'API host', '127.0.0.1')
  .action(async (options) => {
    try {
      const url = `http://${options.host}:${options.port}/status`;
      const response = await fetch(url);
      const data = (await response.json()) as Record<string, unknown>;
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.error('Could not connect to jeeves-watcher. Is it running?');
      process.exit(1);
    }
  });

cli
  .command('init')
  .description('Initialize a new configuration')
  .action(stubAction('init'));

cli
  .command('reindex')
  .description('Reindex all watched files (POST /reindex)')
  .option('-p, --port <port>', 'API port', '3458')
  .option('-H, --host <host>', 'API host', '127.0.0.1')
  .action(async (options) => {
    const url = `${apiBase(options.host, options.port)}/reindex`;
    const res = await fetch(url, { method: 'POST' });
    const text = await res.text();
    if (!res.ok) {
      console.error(text);
      process.exit(1);
    }
    console.log(text);
  });

cli
  .command('rebuild-metadata')
  .description('Rebuild metadata store from Qdrant (POST /rebuild-metadata)')
  .option('-p, --port <port>', 'API port', '3458')
  .option('-H, --host <host>', 'API host', '127.0.0.1')
  .action(async (options) => {
    const url = `${apiBase(options.host, options.port)}/rebuild-metadata`;
    const res = await fetch(url, { method: 'POST' });
    const text = await res.text();
    if (!res.ok) {
      console.error(text);
      process.exit(1);
    }
    console.log(text);
  });

cli
  .command('search')
  .description('Search the vector store (POST /search)')
  .argument('<query>', 'Search query')
  .option('-l, --limit <limit>', 'Max results', '10')
  .option('-p, --port <port>', 'API port', '3458')
  .option('-H, --host <host>', 'API host', '127.0.0.1')
  .action(async (query, options) => {
    const url = `${apiBase(options.host, options.port)}/search`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, limit: Number(options.limit) }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(text);
      process.exit(1);
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(text);
    }
  });

cli
  .command('enrich')
  .description('Enrich document metadata')
  .action(stubAction('enrich'));

cli
  .command('service')
  .description('Manage the watcher as a system service')
  .action(stubAction('service'));

cli
  .command('config-reindex')
  .description('Reindex after configuration changes (POST /config-reindex)')
  .option('-s, --scope <scope>', 'Reindex scope (rules|full)', 'rules')
  .option('-p, --port <port>', 'API port', '3458')
  .option('-H, --host <host>', 'API host', '127.0.0.1')
  .action(async (options) => {
    const scope = options.scope;
    if (scope !== 'rules' && scope !== 'full') {
      console.error('Invalid scope. Must be "rules" or "full"');
      process.exit(1);
    }

    const url = `${apiBase(options.host, options.port)}/config-reindex`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(text);
      process.exit(1);
    }
    console.log(text);
  });

cli.parse();
