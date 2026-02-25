/**
 * @module app/startFromConfig
 * Convenience entry point: loads config from disk and starts a {@link JeevesWatcher}.
 */

import { loadConfig } from '../config';
import { JeevesWatcher } from './index';
import { installShutdownHandlers } from './shutdown';

/**
 * Create and start a JeevesWatcher from a config file path.
 *
 * @param configPath - Optional path to the configuration file.
 * @returns The running JeevesWatcher instance.
 */
export async function startFromConfig(
  configPath?: string,
): Promise<JeevesWatcher> {
  const config = await loadConfig(configPath);
  const app = new JeevesWatcher(config, configPath);

  installShutdownHandlers(() => app.stop());

  await app.start();
  return app;
}
