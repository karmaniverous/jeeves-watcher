/**
 * @module test/qdrant/docker.test
 * startDockerQdrant with `docker` mocked: sweeps containers of dead runs on this host (EPERM counts as alive), discovers the port, removes the container on stop, refuses an empty container id, and removes the container when it never becomes ready.
 */

import { hostname } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OWNER_LABEL, startDockerQdrant } from './docker';
import { registerExitCleanup } from './exitCleanup';
import { waitForQdrantReady } from './readiness';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile, execFileSync: vi.fn() }));
vi.mock('./readiness', () => ({ waitForQdrantReady: vi.fn() }));
vi.mock('./exitCleanup', () => ({ registerExitCleanup: vi.fn() }));

const ID = '0123456789abcdef';
const DEAD_PID = 999_001;
const EPERM_PID = 999_002;

type Reply = { stdout: string } | Error;

/** Answer `docker <subcommand>` calls; record every argument list. */
function docker(replies: Partial<Record<string, Reply>>): string[][] {
  const calls: string[][] = [];
  execFile.mockImplementation(
    (
      _file: string,
      args: string[],
      ...rest: Array<(error: Error | null, out?: unknown) => void>
    ) => {
      calls.push(args);
      const callback = rest[rest.length - 1];
      const reply = replies[args[0]] ?? { stdout: '' };
      if (reply instanceof Error) callback(reply);
      else callback(null, { ...reply, stderr: '' });
    },
  );
  return calls;
}

const listing = [
  `dead1\t${hostname()}:${String(DEAD_PID)}`,
  `live1\t${hostname()}:${String(process.pid)}`,
  `eperm1\t${hostname()}:${String(EPERM_PID)}`,
  `other1\tsome-other-host:${String(DEAD_PID)}`,
].join('\n');

describe('startDockerQdrant', () => {
  const unregister = vi.fn();

  beforeEach(() => {
    vi.mocked(registerExitCleanup).mockReturnValue(unregister);
    vi.mocked(waitForQdrantReady).mockResolvedValue(undefined);
    const kill = process.kill.bind(process);
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      const code =
        pid === DEAD_PID ? 'ESRCH' : pid === EPERM_PID ? 'EPERM' : undefined;
      if (code) throw Object.assign(new Error(code), { code });
      return kill(pid, signal);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('sweeps dead runs on this host only, starts, and removes the container on stop', async () => {
    const calls = docker({
      ps: { stdout: listing },
      run: { stdout: `${ID}\n` },
      port: { stdout: '127.0.0.1:50999\n' },
    });
    const qdrant = await startDockerQdrant();

    expect(calls[0]).toEqual(
      expect.arrayContaining(['ps', `label=${OWNER_LABEL}`]),
    );
    // Live, EPERM (alive, not ours to signal) and other-host containers stay.
    expect(calls[1]).toEqual(['rm', '-f', 'dead1']);
    expect(calls[2][0]).toBe('run');
    expect(calls[3]).toEqual(['port', ID, '6333/tcp']);
    expect(qdrant).toMatchObject({
      url: 'http://127.0.0.1:50999',
      kind: 'docker',
      detail: `container ${ID.slice(0, 12)}`,
    });
    expect(waitForQdrantReady).toHaveBeenCalledWith('http://127.0.0.1:50999');

    await qdrant.stop();
    expect(unregister).toHaveBeenCalledOnce();
    expect(calls.at(-1)).toEqual(['rm', '-f', ID]);
  });

  it('starts anyway when the sweep fails', async () => {
    const calls = docker({
      ps: new Error('docker ps failed'),
      run: { stdout: ID },
      port: { stdout: '127.0.0.1:50999' },
    });
    await expect(startDockerQdrant()).resolves.toMatchObject({
      kind: 'docker',
    });
    expect(calls.map((args) => args[0])).toEqual(['ps', 'run', 'port']);
  });

  it('refuses an empty container id without registering cleanup', async () => {
    docker({ run: { stdout: '  \n' } });
    await expect(startDockerQdrant()).rejects.toThrow(
      'docker run returned no container id',
    );
    expect(registerExitCleanup).not.toHaveBeenCalled();
  });

  it('removes the container and rethrows when it never becomes ready', async () => {
    const calls = docker({
      run: { stdout: ID },
      port: { stdout: '127.0.0.1:50999' },
    });
    vi.mocked(waitForQdrantReady).mockRejectedValue(new Error('not ready'));
    await expect(startDockerQdrant()).rejects.toThrow('not ready');
    expect(calls.at(-1)).toEqual(['rm', '-f', ID]);
    expect(unregister).toHaveBeenCalledOnce();
  });

  it('fails when docker itself is unavailable', async () => {
    docker({ run: new Error('spawn docker ENOENT') });
    await expect(startDockerQdrant()).rejects.toThrow('spawn docker ENOENT');
  });
});
