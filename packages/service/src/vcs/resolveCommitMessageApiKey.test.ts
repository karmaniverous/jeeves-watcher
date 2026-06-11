/**
 * @module vcs/resolveCommitMessageApiKey.test
 * Tests for OpenClaw gateway credential fallback.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCommitMessageApiKey } from './resolveCommitMessageApiKey';

const silentLogger = pino({ level: 'silent' });

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn() };
});

describe('resolveCommitMessageApiKey', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(os.tmpdir(), 'openclaw-test-'));
    vi.mocked(os.homedir).mockReturnValue(tmpHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('uses config apiKey when present (no file read)', () => {
    const result = resolveCommitMessageApiKey(
      'anthropic',
      'config-key-123',
      silentLogger,
    );
    expect(result).toBe('config-key-123');
  });

  it('falls back to OpenClaw gateway key when config apiKey is absent', () => {
    const openclawDir = join(tmpHome, '.openclaw');
    mkdirSync(openclawDir, { recursive: true });
    writeFileSync(
      join(openclawDir, 'openclaw.json'),
      JSON.stringify({
        models: {
          providers: {
            anthropic: { apiKey: 'gateway-key-456' },
          },
        },
      }),
    );

    const result = resolveCommitMessageApiKey(
      'anthropic',
      undefined,
      silentLogger,
    );
    expect(result).toBe('gateway-key-456');
  });

  it('returns undefined when openclaw.json is missing', () => {
    const result = resolveCommitMessageApiKey(
      'anthropic',
      undefined,
      silentLogger,
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when openclaw.json has a different provider', () => {
    const openclawDir = join(tmpHome, '.openclaw');
    mkdirSync(openclawDir, { recursive: true });
    writeFileSync(
      join(openclawDir, 'openclaw.json'),
      JSON.stringify({
        models: {
          providers: {
            openai: { apiKey: 'openai-key-789' },
          },
        },
      }),
    );

    const result = resolveCommitMessageApiKey(
      'anthropic',
      undefined,
      silentLogger,
    );
    expect(result).toBeUndefined();
  });
});
