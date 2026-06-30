/**
 * @module vcs/CommitMessageBuilder
 * Builds commit messages — both template-based and AI-generated.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import type { CommitMessageGenerator } from './CommitMessageGenerator';
import { execFileAsync } from './gitExec';
import type { PendingReversion } from './types';

/**
 * Builds commit messages for VCS commits.
 * Supports template-based messages and AI-generated messages with fallback.
 */
export class CommitMessageBuilder {
  private readonly rootPath: string;
  private readonly logger: pino.Logger;
  private readonly generator: CommitMessageGenerator | undefined;

  constructor(
    rootPath: string,
    logger: pino.Logger,
    generator?: CommitMessageGenerator,
  ) {
    this.rootPath = rootPath;
    this.logger = logger;
    this.generator = generator;
  }

  /**
   * Build the template commit message (no AI).
   */
  buildTemplateMessage(
    fileCount: number,
    isBaseline: boolean,
    pendingReversions: readonly PendingReversion[],
  ): string {
    if (pendingReversions.length === 0) {
      if (isBaseline) {
        return `baseline: batch (${String(fileCount)} files)`;
      }
      const timestamp = new Date().toISOString();
      return `watcher: batch ${timestamp} (${String(fileCount)} files)`;
    }

    // Count total reverted files across all pending reversions
    const revertedPaths = new Set(pendingReversions.flatMap((r) => r.paths));
    const revertedCount = revertedPaths.size;
    const otherCount = fileCount - revertedCount;

    // Use the first reversion's glob and commit for the message
    const { glob, commit } = pendingReversions[0];
    const shortCommit = commit.slice(0, 7);

    let message = `revert: ${glob} to ${shortCommit} — restored ${String(revertedCount)} files`;
    if (otherCount > 0) {
      message += ` (+ ${String(otherCount)} other changes)`;
    }

    return message;
  }

  /**
   * Build the commit message, using AI when available with template fallback.
   */
  async buildCommitMessage(
    files: string[],
    isBaseline: boolean,
    pendingReversions: readonly PendingReversion[],
  ): Promise<string> {
    const fileCount = files.length;
    const templateMessage = this.buildTemplateMessage(
      fileCount,
      isBaseline,
      pendingReversions,
    );

    if (!this.generator) {
      return templateMessage;
    }

    try {
      const diffSummary = await this.getStagedDiff();
      const aiMessage = await this.generator.generate(files, diffSummary);

      if (!aiMessage) {
        this.logger.warn(
          'AI commit message generation returned null; using template',
        );
        return templateMessage;
      }

      // For reversions: prefix with revert info + AI description
      if (pendingReversions.length > 0) {
        const { glob, commit } = pendingReversions[0];
        const shortCommit = commit.slice(0, 7);
        return `revert: ${glob} to ${shortCommit} — ${aiMessage}`;
      }

      return aiMessage;
    } catch (error) {
      this.logger.warn(
        { err: normalizeError(error) },
        'AI commit message generation failed; using template',
      );
      return templateMessage;
    }
  }

  /**
   * Get the staged diff for AI context.
   */
  private async getStagedDiff(): Promise<string> {
    try {
      const { stdout: stat } = await execFileAsync(
        'git',
        ['diff', '--cached', '--stat'],
        { cwd: this.rootPath, timeout: 30_000 },
      );
      const { stdout: patch } = await execFileAsync(
        'git',
        ['diff', '--cached'],
        { cwd: this.rootPath, timeout: 30_000 },
      );
      return `${stat}\n${patch}`;
    } catch {
      return '';
    }
  }
}
