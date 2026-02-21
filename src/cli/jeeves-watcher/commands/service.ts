/**
 * @module commands/service
 *
 * CLI command: service.
 */

import { Command } from '@commander-js/extra-typings';

export function registerServiceCommand(cli: Command): void {
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
}
