/**
 * @module vcs/VcsCoordinator.commitMessage.test
 * VcsCoordinator commit message wiring: without `vcs.commitMessage` the generator gets the core default provider and model (the schema's one source of truth), and a configured model wins. Mocks the generator and key lookup; no git, no network.
 */

import { VCS_DEFAULTS } from '@karmaniverous/jeeves-watcher-core';
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { CommitMessageGenerator } from './CommitMessageGenerator';
import { VcsCoordinator } from './VcsCoordinator';

vi.mock('./CommitMessageGenerator', () => ({
  CommitMessageGenerator: vi.fn(),
}));
vi.mock('./resolveCommitMessageApiKey', () => ({
  resolveCommitMessageApiKey: () => 'test-key',
}));

const logger = pino({ level: 'silent' });

/** A one-root VCS config with the given `vcs` overrides. */
function config(vcs: Record<string, unknown>): JeevesWatcherConfig {
  return {
    vcs: { enabled: true, ...vcs },
    watch: { paths: ['/repo/root/**/*.md'], ignored: [] },
  } as unknown as JeevesWatcherConfig;
}

describe('VcsCoordinator commit message generator', () => {
  beforeEach(() => {
    vi.mocked(CommitMessageGenerator).mockClear();
  });

  it('uses the core default provider and model when commitMessage is unset', () => {
    new VcsCoordinator(config({}), logger);

    expect(CommitMessageGenerator).toHaveBeenCalledOnce();
    const [provider, model] = vi.mocked(CommitMessageGenerator).mock.calls[0];
    expect(provider).toBe(VCS_DEFAULTS.commitMessage.provider);
    expect(model).toBe(VCS_DEFAULTS.commitMessage.model);
    expect(model).toBe('claude-haiku-5-5');
  });

  it('passes a configured model through', () => {
    new VcsCoordinator(
      config({ commitMessage: { model: 'claude-custom' } }),
      logger,
    );

    const [, model] = vi.mocked(CommitMessageGenerator).mock.calls[0];
    expect(model).toBe('claude-custom');
  });
});
