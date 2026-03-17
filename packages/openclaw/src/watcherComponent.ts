/**
 * @module plugin/watcherComponent
 * Jeeves component integration for the watcher OpenClaw plugin.
 *
 * @remarks
 * Uses `createAsyncContentCache()` from core to bridge the sync/async gap:
 * `generateToolsContent()` must be synchronous, but the watcher menu requires
 * async HTTP calls. The cache triggers a background refresh on each call and
 * returns the most recent successful result.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import {
  createAsyncContentCache,
  type JeevesComponent,
  type ServiceCommands,
  type ServiceStatus,
} from '@karmaniverous/jeeves';

import { generateWatcherMenu } from './promptInjection.js';

const execFile = promisify(execFileCb);

/** Options for creating the watcher component descriptor. */
interface CreateWatcherComponentOptions {
  /** Base URL of the jeeves-watcher HTTP API. */
  apiUrl: string;
  /** Plugin package version. */
  pluginVersion: string;
}

/** Shape of the watcher `/status` response (subset). */
interface StatusResponse {
  version?: string;
  uptime?: number;
}

/**
 * Probe the watcher HTTP API for service health.
 *
 * @param apiUrl - Base URL of the watcher API.
 * @returns Service status with running flag, optional version and uptime.
 */
async function getServiceStatus(apiUrl: string): Promise<ServiceStatus> {
  try {
    const res = await fetch(`${apiUrl}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { running: false };

    const json = (await res.json()) as StatusResponse;
    return {
      running: true,
      version: typeof json.version === 'string' ? json.version : undefined,
      uptimeSeconds: typeof json.uptime === 'number' ? json.uptime : undefined,
    };
  } catch {
    return { running: false };
  }
}

/**
 * Create the watcher `JeevesComponent` descriptor.
 *
 * @param options - API URL and plugin version.
 * @returns A fully configured component descriptor ready for `createComponentWriter()`.
 */
export function createWatcherComponent(
  options: CreateWatcherComponentOptions,
): JeevesComponent {
  const { apiUrl, pluginVersion } = options;

  const getContent = createAsyncContentCache({
    fetch: async () => generateWatcherMenu(apiUrl),
    placeholder: '> Initializing watcher menu...',
  });

  return {
    name: 'watcher',
    version: pluginVersion,
    sectionId: 'Watcher',
    refreshIntervalSeconds: 71,

    generateToolsContent: getContent,

    serviceCommands: {
      async stop(): Promise<void> {
        await execFile('jeeves-watcher', ['service', 'stop']);
      },
      async uninstall(): Promise<void> {
        await execFile('jeeves-watcher', ['service', 'uninstall']);
      },
      async status(): Promise<ServiceStatus> {
        return getServiceStatus(apiUrl);
      },
    } satisfies ServiceCommands,

    pluginCommands: {
      async uninstall(): Promise<void> {
        await execFile('npx', [
          '-y',
          '@karmaniverous/jeeves-watcher-openclaw',
          'uninstall',
        ]);
      },
    },
  };
}
