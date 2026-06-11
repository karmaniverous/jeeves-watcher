/**
 * @module vcs/CommitMessageGenerator
 * Generates AI-powered commit messages via the Anthropic Messages API.
 */

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';

/** Maximum characters of diff to send to the AI. */
const MAX_DIFF_CHARS = 4000;

/** Maximum length of the generated commit message. */
const MAX_MESSAGE_LENGTH = 100;

/** Request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 15000;

/** System prompt for the commit message generator. */
const SYSTEM_PROMPT =
  'You are a commit message generator. Given file changes, produce a single concise one-line commit message. No prefix. No punctuation at end';

/**
 * Generates AI commit messages using the Anthropic Messages API.
 */
export class CommitMessageGenerator {
  private readonly provider: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly logger: pino.Logger;

  constructor(
    provider: string,
    model: string,
    apiKey: string | undefined,
    logger: pino.Logger,
  ) {
    this.provider = provider;
    this.model = model;
    this.apiKey = apiKey;
    this.logger = logger;
  }

  /**
   * Generate a commit message from file changes.
   *
   * @param files - List of changed file paths.
   * @param diffSummary - Combined diff output (stat + patch).
   * @returns A one-line commit message, or null on failure.
   */
  async generate(files: string[], diffSummary: string): Promise<string | null> {
    if (!this.apiKey) {
      this.logger.warn('No API key configured for commit message generation');
      return null;
    }

    if (this.provider !== 'anthropic') {
      this.logger.warn(
        { provider: this.provider },
        'Unsupported commit message provider; only "anthropic" is supported',
      );
      return null;
    }

    const truncatedDiff = diffSummary.slice(0, MAX_DIFF_CHARS);
    const userPrompt = `Files changed:\n${files.join('\n')}\n\nDiff:\n${truncatedDiff}`;

    try {
      const body = JSON.stringify({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.warn(
          { status: response.status, body: text },
          'Anthropic API returned non-OK status',
        );
        return null;
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };

      const textBlock = data.content?.find((b) => b.type === 'text');
      if (!textBlock?.text) {
        this.logger.warn('Anthropic API returned no text content');
        return null;
      }

      const message = textBlock.text.trim().slice(0, MAX_MESSAGE_LENGTH);
      this.logger.debug({ message }, 'AI commit message generated');
      return message;
    } catch (error) {
      this.logger.warn(
        { err: normalizeError(error) },
        'Failed to generate AI commit message',
      );
      return null;
    }
  }
}
