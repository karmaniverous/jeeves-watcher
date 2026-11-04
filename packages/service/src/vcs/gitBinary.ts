/**
 * @module vcs/gitBinary
 * Resolve the real git executable once per process (`git --exec-path`), so a timed-out call can be killed for real (D79). Spawns git once; no other I/O.
 *
 * On Windows, `git` on `PATH` is Git for Windows' `cmd\git.exe` launcher.
 * Killing the launcher leaves the real `git.exe` running and holding
 * `index.lock`, so every VCS git call runs the binary in git's exec path
 * instead. On Linux, `git` is already the real binary, and the exec path
 * holds it too.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Resolved executable, set on first use. */
let resolved: string | undefined;

/**
 * Find the real git binary: `<git --exec-path>/git(.exe)` when it exists,
 * else plain `git` (resolved through `PATH`).
 *
 * @param platform - Platform to resolve for (default: `process.platform`).
 * @param readExecPath - Returns git's exec path (injectable for tests).
 * @returns The executable to spawn.
 */
export function findGitBinary(
  platform: string = process.platform,
  readExecPath: () => string = () =>
    execFileSync('git', ['--exec-path'], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    }),
): string {
  try {
    const execPath = readExecPath().trim();
    if (!execPath) return 'git';
    const candidate = join(execPath, platform === 'win32' ? 'git.exe' : 'git');
    return existsSync(candidate) ? candidate : 'git';
  } catch {
    return 'git';
  }
}

/**
 * The git executable every VCS call spawns. Resolved once, on first use
 * (the service warms it at startup through `checkGitAvailable`).
 *
 * @returns The absolute path of the real git binary, or `git`.
 */
export function gitBinary(): string {
  resolved ??= findGitBinary();
  return resolved;
}

/**
 * Whether git runs through `PATH` on Windows, where `git` is the launcher
 * D79 rules out: killing it leaves the real git holding `index.lock`.
 *
 * @param platform - Platform (default: `process.platform`).
 * @param binary - Resolved executable (default: {@link gitBinary}).
 * @returns true when timed-out calls cannot be killed reliably.
 */
export function killsLauncher(
  platform: string = process.platform,
  binary: string = gitBinary(),
): boolean {
  return platform === 'win32' && binary === 'git';
}
