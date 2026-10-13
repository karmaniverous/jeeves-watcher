/**
 * @module test/qdrant/docker
 * Docker fallback for the throwaway test Qdrant: `docker run --rm -d` the pinned image on a random loopback port, discover the port, `docker rm -f` on stop.
 * Child-process I/O; {@link dockerRunArgs} is pure.
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import { QDRANT_VERSION } from './assets';
import type { EphemeralQdrant } from './ephemeralQdrant';
import { registerExitCleanup } from './exitCleanup';
import { parseDockerPort } from './ports';
import { waitForQdrantReady } from './readiness';

const execFileAsync = promisify(execFile);

/** Image used for the fallback; matches the CI service container. */
export const QDRANT_IMAGE = `qdrant/qdrant:v${QDRANT_VERSION}`;

/**
 * Arguments for `docker run`: detached, removed on stop, REST port published
 * on a random 127.0.0.1 port, telemetry off.
 *
 * @param image - Image reference (default {@link QDRANT_IMAGE}).
 * @returns The argument list.
 */
export function dockerRunArgs(image: string = QDRANT_IMAGE): string[] {
  return [
    'run',
    '--rm',
    '-d',
    '-p',
    '127.0.0.1::6333',
    '-e',
    'QDRANT__TELEMETRY_DISABLED=true',
    image,
  ];
}

/**
 * Start Qdrant in Docker and wait until it is ready.
 *
 * @returns The running instance.
 * @throws When Docker is unavailable or the container is not ready in time
 * (the container is removed first).
 */
export async function startDockerQdrant(): Promise<EphemeralQdrant> {
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
