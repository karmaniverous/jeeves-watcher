/**
 * @module test/qdrant/binary
 * Start a Qdrant release binary as a child process on free 127.0.0.1 ports with storage, snapshots and temp files in a fresh temp dir; stop kills it and deletes the dir.
 * Configuration is passed only through `QDRANT__*` environment variables (any inherited ones are stripped first), so no config file or shared state is read.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, toNamespacedPath } from 'node:path';

import type { EphemeralQdrant } from './ephemeralQdrant';
import { registerExitCleanup } from './exitCleanup';
import { findFreePort } from './ports';
import { waitForQdrantReady } from './readiness';

/** Keep the last few KB of Qdrant output for error messages. */
const LOG_TAIL_BYTES = 4_096;

/**
 * A storage path for Qdrant. On Windows it is namespaced (`\\?\C:\...`):
 * segment files under a temp dir plus a long harness collection name exceed
 * MAX_PATH (260), which fails payload-index creation. No-op elsewhere.
 */
function storagePath(dir: string, leaf: string): string {
  return toNamespacedPath(join(dir, leaf));
}

/**
 * Copy of an environment without any `QDRANT__*` variable, so settings
 * from the developer's shell (e.g. another storage path or an API key) can
 * never reach the throwaway Qdrant. Pure.
 *
 * @param env - Source environment.
 * @returns The filtered copy.
 */
export function withoutQdrantSettings(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !key.toUpperCase().startsWith('QDRANT__'),
    ),
  );
}

/**
 * Environment for the Qdrant child: loopback only, given ports, all state
 * under `dir` (long-path safe on Windows), telemetry off. Inherited
 * `QDRANT__*` variables are dropped.
 *
 * @param dir - Fresh temp directory.
 * @param httpPort - REST port.
 * @param grpcPort - gRPC port.
 * @param env - Environment to start from (default `process.env`).
 * @returns `QDRANT__*` variables merged over the filtered environment.
 */
export function qdrantChildEnv(
  dir: string,
  httpPort: number,
  grpcPort: number,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...withoutQdrantSettings(env),
    QDRANT__SERVICE__HOST: '127.0.0.1',
    QDRANT__SERVICE__HTTP_PORT: String(httpPort),
    QDRANT__SERVICE__GRPC_PORT: String(grpcPort),
    QDRANT__STORAGE__STORAGE_PATH: storagePath(dir, 'storage'),
    QDRANT__STORAGE__SNAPSHOTS_PATH: storagePath(dir, 'snapshots'),
    QDRANT__STORAGE__TEMP_PATH: storagePath(dir, 'tmp'),
    QDRANT__TELEMETRY_DISABLED: 'true',
    QDRANT__LOG_LEVEL: 'WARN',
  };
}

/** Delete the temp dir, retrying while Windows releases file handles. */
function removeDir(dir: string): void {
  rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

/** Wait (bounded) for a child to exit. */
async function waitForExit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Start the Qdrant executable and wait until it is ready.
 *
 * @param binaryPath - Verified Qdrant executable.
 * @returns The running instance.
 * @throws When it exits or is not ready in time (everything is cleaned up first).
 */
export async function startBinaryQdrant(
  binaryPath: string,
): Promise<EphemeralQdrant> {
  const dir = mkdtempSync(join(tmpdir(), 'jeeves-watcher-qdrant-'));
  const httpPort = await findFreePort();
  let grpcPort = await findFreePort();
  while (grpcPort === httpPort) grpcPort = await findFreePort();

  let tail = '';
  const child = spawn(binaryPath, [], {
    cwd: dir,
    env: qdrantChildEnv(dir, httpPort, grpcPort),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const collect = (chunk: Buffer): void => {
    tail = (tail + chunk.toString()).slice(-LOG_TAIL_BYTES);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let spawnError: Error | undefined;
  child.once('error', (error) => {
    spawnError = error;
  });

  const killSync = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    removeDir(dir);
  };
  const unregister = registerExitCleanup(killSync);

  const stop = async (): Promise<void> => {
    unregister();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await waitForExit(child, 10_000);
    removeDir(dir);
  };

  const url = `http://127.0.0.1:${String(httpPort)}`;
  try {
    await waitForQdrantReady(url, {
      abortReason: () => {
        if (spawnError) return spawnError.message;
        if (child.exitCode !== null)
          return `process exited with code ${String(child.exitCode)}`;
        return undefined;
      },
    });
  } catch (error) {
    await stop();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n--- qdrant output ---\n${tail}`, {
      cause: error,
    });
  }

  return {
    url,
    kind: 'binary',
    detail: `pid ${String(child.pid)}, ${dir}`,
    stop,
  };
}
