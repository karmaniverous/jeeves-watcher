/**
 * @module vcs/vcsPush
 * Push logic for VCS commits.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { execFileAsync } from './gitExec';
import type { PushError } from './types';

/**
 * Push to the configured remote if remoteUrl is set.
 *
 * On failure: logs the error, appends to pushErrors, and returns undefined.
 * Never throws.
 *
 * @param rootPath - Absolute path of the git repository.
 * @param remoteUrl - Remote URL to push to, or undefined to skip.
 * @param accessToken - Optional token for HTTPS authentication.
 * @param pushErrors - Mutable array where push errors are recorded.
 * @param logger - Logger instance.
 * @returns ISO timestamp of a successful push, or undefined if skipped/failed.
 */
export async function pushToRemote(
  rootPath: string,
  remoteUrl: string | undefined,
  accessToken: string | undefined,
  pushErrors: PushError[],
  logger: pino.Logger,
): Promise<string | undefined> {
  if (!remoteUrl) return undefined;

  try {
    // Build the authenticated URL if a token is available
    const pushUrl = accessToken
      ? remoteUrl.replace(
          /^https:\/\//,
          `https://${encodeURIComponent(accessToken)}@`,
        )
      : remoteUrl;

    await execFileAsync('git', ['push', pushUrl, 'HEAD'], {
      cwd: rootPath,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 60_000,
    });

    const timestamp = new Date().toISOString();
    logger.info({ root: rootPath, remote: remoteUrl }, 'VCS push succeeded');
    return timestamp;
  } catch (error) {
    const pushError: PushError = {
      timestamp: new Date().toISOString(),
      message: normalizeError(error).message,
    };
    pushErrors.push(pushError);
    logger.error(
      { root: rootPath, err: normalizeError(error) },
      'VCS push failed',
    );
    return undefined;
  }
}
