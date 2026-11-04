/**
 * @module vcs/gitProcess
 * Spawn the real git binary with optional stdin, a timeout and a buffer cap. On a timeout the child is killed, its exit awaited, and an `index.lock` it created is removed (D79).
 *
 * Every VCS git call (index, plumbing, network, reads) goes through
 * {@link execGit}. Killing the real binary (not Git for Windows' launcher,
 * see `gitBinary`) and awaiting its `exit` event means "exited" really
 * means exited. A call that takes an index lock names it
 * ({@link ExecGitOptions.indexLockPath}); git creates the lock exclusively,
 * so for such a call a lock whose mtime lies between our spawn and that
 * exit can only be ours, and is removed before the {@link GitTimeoutError}
 * reaches the caller (who then bisects or applies D20's rules). A call that
 * takes no index lock (reads, `commit-tree`, `update-ref`, push) names
 * none: a lock created while it ran belongs to another writer and is left
 * alone.
 */

import { spawn } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { gitBinary } from './gitBinary';

/** Default cap on buffered stdout (large corpora list many paths). */
const DEFAULT_MAX_BUFFER = 256 * 1024 * 1024;

/** Options for {@link execGit}. */
export interface ExecGitOptions {
  /** Working directory (the repository root). */
  cwd: string;
  /** Kill the child after this many milliseconds. */
  timeoutMs: number;
  /** Written to the child's stdin, which is then closed. */
  input?: string | Buffer;
  /** Child environment (default: `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Max stdout bytes before the child is killed and the call fails. */
  maxBuffer?: number;
  /**
   * The index lock this call takes ({@link realIndexLock}, or
   * `<GIT_INDEX_FILE>.lock` for a private index), removed after a timeout
   * when created within the call's window. Omit it for a call that takes no
   * index lock: nothing is removed then.
   */
  indexLockPath?: string;
}

/**
 * The real index's lock, `<root>/.git/index.lock`.
 *
 * @param root - Repository root.
 * @returns The lock path.
 */
export function realIndexLock(root: string): string {
  return join(root, '.git', 'index.lock');
}

/** Output of a successful git call. */
export interface ExecGitResult {
  /** stdout, raw bytes. */
  stdoutBuffer: Buffer;
  /** stdout decoded as UTF-8. */
  stdout: string;
  /** stderr decoded as UTF-8. */
  stderr: string;
}

/** A git call killed by its timeout (after the child exited). */
export class GitTimeoutError extends Error {
  /** Errno-style code, for callers that read `code`. */
  readonly code = 'ETIMEDOUT';

  /**
   * @param command - The command, for the message.
   * @param timeoutMs - The timeout that fired.
   * @param spawnedAt - Epoch ms just before the spawn.
   * @param exitedAt - Epoch ms of the child's `exit` event.
   * @param removedIndexLock - Whether our own `index.lock` was removed.
   * @param pid - Process id of the killed child.
   */
  constructor(
    command: string,
    readonly timeoutMs: number,
    readonly spawnedAt: number,
    readonly exitedAt: number,
    readonly removedIndexLock: boolean,
    readonly pid?: number,
  ) {
    super(`${command} timed out after ${String(timeoutMs)}ms`);
    this.name = 'GitTimeoutError';
  }
}

/**
 * Whether a caught value is a {@link GitTimeoutError}.
 *
 * @param error - The caught value.
 * @returns true for a git timeout.
 */
export function isGitTimeout(error: unknown): error is GitTimeoutError {
  return error instanceof GitTimeoutError;
}

/**
 * Remove `lockPath` if its mtime lies within `[spawnedAt, exitedAt]`
 * (millisecond resolution): only the timed-out child can have created it.
 *
 * @returns true if the lock was removed.
 */
export async function removeOwnIndexLock(
  lockPath: string,
  spawnedAt: number,
  exitedAt: number,
): Promise<boolean> {
  try {
    const mtime = Math.floor((await stat(lockPath)).mtimeMs);
    if (mtime < spawnedAt || mtime > exitedAt) return false;
    await rm(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The command as error messages show it: paths after `--` are counted, not
 * listed (a tracked-check chunk holds up to 500 of them, which would flood
 * logs and `/vcs/status`).
 *
 * @param args - Full argv after the executable.
 * @returns `git <args>`, with `-- <n paths>` in place of a path list.
 */
export function describeCommand(args: readonly string[]): string {
  const separator = args.indexOf('--');
  if (separator === -1) return `git ${args.join(' ')}`;
  const paths = args.length - separator - 1;
  return `git ${args.slice(0, separator + 1).join(' ')} <${String(paths)} path${paths === 1 ? '' : 's'}>`;
}

/** Build the error a non-zero exit rejects with (execFile's shape). */
function exitError(
  command: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string,
): Error {
  const error = new Error(
    `Command failed: ${command}${stderr ? `\n${stderr}` : ''}`,
  );
  Object.assign(error, { code, signal, cmd: command, stdout, stderr });
  return error;
}

/**
 * Run `<real git> <args>`.
 *
 * Rejects with an execFile-shaped error (`code` = exit status, `stdout`,
 * `stderr`, `cmd`) on a non-zero exit, with a {@link GitTimeoutError} on a
 * timeout (after the exit and the own-lock check), and with the spawn
 * error if git cannot start.
 *
 * @param args - Full argv after the executable.
 * @param options - Working directory, timeout, stdin, env, buffer cap.
 * @returns stdout (bytes and text) and stderr.
 */
export function execGit(
  args: readonly string[],
  options: ExecGitOptions,
): Promise<ExecGitResult> {
  const command = describeCommand(args);
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const lockPath = options.indexLockPath;

  return new Promise((resolvePromise, reject) => {
    const spawnedAt = Date.now();
    const child = spawn(gitBinary(), [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let timedOut = false;
    let overflow = false;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxBuffer) {
        overflow = true;
        child.kill('SIGKILL');
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    // A spawn failure (e.g. ENOENT) may never emit 'exit'.
    child.on('error', (error) => {
      settle(() => {
        reject(error);
      });
    });
    // EPIPE is expected when git exits before reading all of stdin.
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input ?? '');

    // A killed child settles on 'exit' (the process is gone), not on
    // 'close', which a grandchild holding the pipes could delay.
    child.on('exit', () => {
      if (!timedOut) return;
      const exitedAt = Date.now();
      settle(() => {
        const removal =
          lockPath === undefined
            ? Promise.resolve(false)
            : removeOwnIndexLock(lockPath, spawnedAt, exitedAt);
        void removal.then((removed) => {
          reject(
            new GitTimeoutError(
              command,
              options.timeoutMs,
              spawnedAt,
              exitedAt,
              removed,
              child.pid,
            ),
          );
        });
      });
    });

    /** Resolve or reject from the closed child's exit status and output. */
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      const stdoutBuffer = Buffer.concat(out);
      const stdout = stdoutBuffer.toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (overflow) {
        reject(
          exitError(
            command,
            code,
            signal,
            '',
            `stdout exceeded ${String(maxBuffer)} bytes`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(exitError(command, code, signal, stdout, stderr));
        return;
      }
      resolvePromise({ stdoutBuffer, stdout, stderr });
    };

    child.on('close', (code, signal) => {
      settle(() => {
        finish(code, signal);
      });
    });
  });
}
