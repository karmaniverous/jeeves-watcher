/**
 * @module app/configWatcher
 * Watches the config file for changes and triggers debounced reload. Isolated I/O wrapper around chokidar.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import type pino from 'pino';

export interface ConfigWatcherOptions {
  configPath: string;
  enabled: boolean;
  debounceMs: number;
  logger: pino.Logger;
  onChange: () => void | Promise<void>;
}

/**
 * Debounced config file watcher.
 */
export class ConfigWatcher {
  private readonly options: ConfigWatcherOptions;
  private watcher: FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;

  constructor(options: ConfigWatcherOptions) {
    this.options = options;
  }

  start(): void {
    if (!this.options.enabled) return;

    this.watcher = chokidar.watch(this.options.configPath, {
      ignoreInitial: true,
    });

    this.watcher.on('change', () => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        void this.options.onChange();
      }, this.options.debounceMs);
    });

    this.watcher.on('error', (error: unknown) => {
      this.options.logger.error({ error }, 'Config watcher error');
    });

    this.options.logger.info(
      { configPath: this.options.configPath, debounceMs: this.options.debounceMs },
      'Config watcher started',
    );
  }

  async stop(): Promise<void> {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = undefined;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
  }
}
