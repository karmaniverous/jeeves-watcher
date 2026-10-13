/**
 * @module test/qdrant/docker
 * Docker fallback for the throwaway test Qdrant: `docker run --rm -d` the pinned image (labelled with its owner host:pid) on a random loopback port, discover the port, `docker rm -f` on stop.
 * Each start first sweeps containers left by dead runs on this host. Child-process I/O; {@link dockerRunArgs} and {@link staleContainers} are pure.
 */

import { execFile, execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';

import { QDRANT_VERSION } from './assets';
import type { EphemeralQdrant } from './ephemeralQdrant';
import { registerExitCleanup } from './exitCleanup';
import { parseDockerPort } from './ports';
import { waitForQdrantReady } from './readiness';

const execFileAsync = promisify(execFile);

/** Image used for the fallback; matches the CI service container. */
export const QDRANT_IMAGE = `qdrant/qdrant:v${QDRANT_VERSION}`;

/** Label marking a test container; its value is the owner `host:pid`. */
export const OWNER_LABEL = 'jeeves-watcher.test-qdrant.owner';

/**
 * The owner label value for this process.
 *
 * @returns `<hostname>:<pid>`.
 */
function ownerLabelValue(): string {
  return `${hostname()}:${String(process.pid)}`;
}

/**
 * Arguments for `docker run`: detached, removed on stop, labelled with its
 * owner, REST port published on a random 127.0.0.1 port, telemetry off.
 *
 * @param image - Image reference (default {@link QDRANT_IMAGE}).
 * @param owner - Owner label value (default {@link ownerLabelValue}).
 * @returns The argument list.
 */
export function dockerRunArgs(
  image: string = QDRANT_IMAGE,
  owner: string = ownerLabelValue(),
): string[] {
  return [
    'run',
    '--rm',
    '-d',
    '--label',
    `${OWNER_LABEL}=${owner}`,
    '-p',
    '127.0.0.1::6333',
    '-e',
    'QDRANT__TELEMETRY_DISABLED=true',
    image,
  ];
}

/**
 * Containers to sweep: labelled by a process on `host` that is no longer
 * alive. Containers of live runs and of other hosts are kept. Pure.
 *
 * @param listing - `docker ps` lines: `<id>\t<owner label value>`.
 * @param host - This host's name.
 * @param isAlive - Whether a pid on this host is running.
 * @returns Container ids to remove.
 */
export function staleContainers(
  listing: string,
  host: string,
  isAlive: (pid: number) => boolean,
): string[] {
  const stale: string[] = [];
  for (const line of listing.split(/\r?\n/)) {
    const [id, owner = ''] = line.trim().split('\t');
    const separator = owner.lastIndexOf(':');
    if (!id || separator < 0) continue;
    const pid = Number(owner.slice(separator + 1));
    if (owner.slice(0, separator) !== host || !Number.isInteger(pid)) continue;
    if (!isAlive(pid)) stale.push(id);
  }
  return stale;
}

/** Whether a local process exists (EPERM: exists, not ours to signal). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Remove test containers left behind by dead runs on this host (e.g. a
 * killed test process whose exit hook never ran). Best effort.
 *
 * @returns The container ids removed.
 */
async function sweepStaleContainers(): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      `label=${OWNER_LABEL}`,
      '--format',
      `{{.ID}}\t{{.Label "${OWNER_LABEL}"}}`,
    ],
    { timeout: 60_000 },
  );
  const stale = staleContainers(stdout, hostname(), pidAlive);
  if (stale.length) {
    await execFileAsync('docker', ['rm', '-f', ...stale], { timeout: 60_000 });
  }
  return stale;
}

/**
 * Start Qdrant in Docker and wait until it is ready.
 *
 * @returns The running instance.
 * @throws When Docker is unavailable or the container is not ready in time
 * (the container is removed first).
 */
export async function startDockerQdrant(): Promise<EphemeralQdrant> {
  await sweepStaleContainers().catch(() => []);
  const { stdout } = await execFileAsync('docker', dockerRunArgs(), {
    timeout: 300_000,
  });
  const id = stdout.trim();
  if (!id) throw new Error('docker run returned no container id');

  const removeSync = (): void => {
    execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
  };
  const unregister = registerExitCleanup(removeSync);
  const stop = async (): Promise<void> => {
    unregister();
    await execFileAsync('docker', ['rm', '-f', id], { timeout: 60_000 });
  };

  try {
    const ports = await execFileAsync('docker', ['port', id, '6333/tcp']);
    const url = `http://127.0.0.1:${String(parseDockerPort(ports.stdout))}`;
    await waitForQdrantReady(url);
    return {
      url,
      kind: 'docker',
      detail: `container ${id.slice(0, 12)}`,
      stop,
    };
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
}
