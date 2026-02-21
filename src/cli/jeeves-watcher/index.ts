#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

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

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

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
  .command('status')
  .description('Show watcher status')
  .option('-p, --port <port>', 'API port', '3456')
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

cli
  .command('reindex')
  .description('Reindex all watched files (POST /reindex)')
  .option('-p, --port <port>', 'API port', '3456')
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
  .option('-p, --port <port>', 'API port', '3456')
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
  .option('-p, --port <port>', 'API port', '3456')
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
  .description('Generate service install/uninstall instructions')
  .addCommand(
    new Command('install')
      .description('Print install instructions for a system service')
      .option('-c, --config <path>', 'Path to configuration file')
      .option('-n, --name <name>', 'Service name', 'jeeves-watcher')
      .action((options) => {
        const name = options.name;
        const configPath = options.config;

        if (process.platform === 'win32') {
          console.log('NSSM install (example):');
          console.log(
            `  nssm install ${name} node "%CD%\\node_modules\\@karmaniverous\\jeeves-watcher\\dist\\cli\\jeeves-watcher\\index.js" start${
              configPath ? ` --config "${configPath}"` : ''
            }`,
          );
          console.log(`  nssm set ${name} AppDirectory "%CD%"`);
          console.log(`  nssm set ${name} Start SERVICE_AUTO_START`);
          console.log(`  nssm start ${name}`);
          return;
        }

        const unit = `[Unit]\nDescription=Jeeves Watcher\nAfter=network.target\n\n[Service]\nType=simple\nWorkingDirectory=%h\nExecStart=/usr/bin/env jeeves-watcher start${
          configPath ? ` --config ${configPath}` : ''
        }\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`;

        console.log('# systemd unit file');
        console.log(`# ~/.config/systemd/user/${name}.service`);
        console.log(unit);
        console.log('# install');
        console.log(`  systemctl --user daemon-reload`);
        console.log(`  systemctl --user enable --now ${name}.service`);
      }),
  )
  .addCommand(
    new Command('uninstall')
      .description('Print uninstall instructions for a system service')
      .option('-n, --name <name>', 'Service name', 'jeeves-watcher')
      .action((options) => {
        const name = options.name;

        if (process.platform === 'win32') {
          console.log('NSSM uninstall (example):');
          console.log(`  nssm stop ${name}`);
          console.log(`  nssm remove ${name} confirm`);
          return;
        }

        console.log('# systemd uninstall');
        console.log(`  systemctl --user disable --now ${name}.service`);
        console.log(`# remove ~/.config/systemd/user/${name}.service`);
        console.log(`  systemctl --user daemon-reload`);
      }),
  );

cli
  .command('config-reindex')
  .description('Reindex after configuration changes (POST /config-reindex)')
  .option('-s, --scope <scope>', 'Reindex scope (rules|full)', 'rules')
  .option('-p, --port <port>', 'API port', '3456')
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
