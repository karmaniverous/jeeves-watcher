/**
 * @module plugin/watcherComponent
 * Jeeves component integration for the watcher OpenClaw plugin.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  JeevesComponent,
  ServiceCommands,
  ServiceStatus,
} from '@karmaniverous/jeeves';

import { generateWatcherMenu } from './promptInjection.js';

const execFile = promisify(execFileCb);

interface CreateWatcherComponentOptions {
  apiUrl: string;
  pluginVersion: string;
}

interface StatusResponse {
  version?: string;
  uptime?: number;
}

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

function createPluginCommands(): { uninstall(): Promise<void> } {
  return {
    async uninstall(): Promise<void> {
      // Delegate to the published plugin CLI.
      // NOTE: This is a best-effort helper; it may not be desirable to run from
      // inside the gateway process depending on how OpenClaw hosts plugins.
      await execFile('npx', [
        '-y',
        '@karmaniverous/jeeves-watcher-openclaw',
        'uninstall',
      ]);
    },
  };
}

/**
 * Create the watcher component descriptor plus a prime promise.
 *
 * @remarks
 * `generateToolsContent()` must be synchronous, but the watcher menu requires
 * async HTTP calls. We use a cached menu string and prime it once on startup.
 */
export function createWatcherComponent(
  options: CreateWatcherComponentOptions,
): { component: JeevesComponent; prime: Promise<void> } {
  const { apiUrl, pluginVersion } = options;

  let cachedMenu = 'Initializing watcher menu...';

  const refresh = async (): Promise<void> => {
    cachedMenu = await generateWatcherMenu(apiUrl);
  };

  // Prime immediately.
  const prime = refresh().catch(() => {
    // generateWatcherMenu is designed to return an actionable message instead
    // of throwing, but guard anyway.
    cachedMenu = `> **ACTION REQUIRED:** Failed to generate watcher menu for ${apiUrl}`;
  });

  // Keep the cached menu fresh on the same prime interval the writer uses.
  const refreshIntervalMs = 71_000;
  const intervalHandle = setInterval(() => {
    void refresh();
  }, refreshIntervalMs);
  intervalHandle.unref();

  const component: JeevesComponent = {
    name: 'watcher',
    version: pluginVersion,
    sectionId: 'Watcher',
    refreshIntervalSeconds: 71,

    generateToolsContent(): string {
      return cachedMenu;
    },

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

    pluginCommands: createPluginCommands(),
  };

  return { component, prime };
}
