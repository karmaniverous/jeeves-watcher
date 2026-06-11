/**
 * @module vcs/resolveCommitMessageApiKey
 * Resolves the API key for AI commit message generation.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type pino from 'pino';

/**
 * Resolve the API key for commit message generation.
 * Checks config first, then falls back to OpenClaw gateway credentials.
 */
export function resolveCommitMessageApiKey(
  provider: string,
  configApiKey: string | undefined,
  logger: pino.Logger,
): string | undefined {
  if (configApiKey) {
    logger.debug('Using commit message API key from config');
    return configApiKey;
  }

  try {
    const openclawPath = join(homedir(), '.openclaw', 'openclaw.json');
    const raw = readFileSync(openclawPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      models?: { providers?: Record<string, { apiKey?: string }> };
    };
    const gatewayKey = parsed.models?.providers?.[provider]?.apiKey;
    if (gatewayKey) {
      logger.debug(
        { provider },
        'Using commit message API key from OpenClaw gateway config',
      );
      return gatewayKey;
    }
    logger.warn(
      { provider },
      'OpenClaw gateway config found but no API key for provider',
    );
  } catch {
    logger.warn('No commit message API key in config or OpenClaw gateway');
  }

  return undefined;
}
