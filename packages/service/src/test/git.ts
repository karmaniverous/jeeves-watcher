/**
 * @module test/git
 * Hermetic git for tests.
 *
 * Tests run real git. Without isolation, git reads the machine's system and
 * global config and inherits prompt-related variables from the shell that
 * started vitest. On a developer box that can mean Git Credential Manager
 * (Git for Windows' system default), an editor's `GIT_ASKPASS` (e.g. the
 * VS Code terminal), GPG commit signing, or a global ignore file. Any of
 * these can block a git child on a prompt nobody sees; the test then times
 * out and the orphaned child keeps its temp directory locked (`EBUSY` at
 * cleanup).
 *
 * {@link applyHermeticGitEnv} runs from the vitest setup file before every
 * test file, so every git child (spawned by a test or by the code under
 * test) inherits an environment that ignores system and global config and
 * can never prompt. Tests that spawn git themselves use
 * {@link execFileAsync}, which also kills a stuck child.
 */

import { execFile, type ExecFileOptions } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Kill timeout (ms) for git children spawned by tests.
 *
 * Below vitest's default 5 s test timeout, so a stuck child is killed (and
 * its error reported) before the test is abandoned and its temp directory
 * is removed.
 */
export const TEST_GIT_TIMEOUT_MS = 4_000;

/**
 * Global config path that reads as an empty file on every platform (Git for
 * Windows maps `/dev/null` to `NUL`).
 */
const EMPTY_GIT_CONFIG = '/dev/null';

/**
 * Build a hermetic git environment from a base environment.
 *
 * Drops every inherited `GIT_*` variable (repository redirection such as
 * `GIT_DIR` set by git hooks, injected config, askpass, tracing) and then:
 * ignores system config, points global config at an empty file, moves the
 * XDG config home (global ignore and attributes files) somewhere empty, and
 * disables every prompt path.
 *
 * @param base - Environment to start from (not mutated).
 * @returns The hermetic environment.
 */
export function hermeticGitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(base).filter(([key]) => !/^GIT_/i.test(key)),
  );
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG,
    XDG_CONFIG_HOME: join(tmpdir(), 'jeeves-watcher-test-no-xdg-config'),
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
}

/**
 * Replace `process.env` git-related variables with {@link hermeticGitEnv}.
 *
 * Mutates `process.env` in place so that later reads and every child
 * process see the hermetic values.
 */
export function applyHermeticGitEnv(): void {
  const next = hermeticGitEnv(process.env);
  for (const key of Object.keys(process.env)) {
    if (!(key in next)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, next);
}

const execFileRaw = promisify(execFile);

/**
 * Promisified `execFile` for tests, with a default kill timeout of
 * {@link TEST_GIT_TIMEOUT_MS}.
 *
 * @param file - Executable (normally `'git'`).
 * @param args - Arguments.
 * @param options - `execFile` options; an explicit `timeout` wins.
 * @returns The child's stdout and stderr.
 */
export function execFileAsync(
  file: string,
  args: readonly string[] = [],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileRaw(file, args, {
    timeout: TEST_GIT_TIMEOUT_MS,
    ...options,
    encoding: 'utf8',
  });
}
