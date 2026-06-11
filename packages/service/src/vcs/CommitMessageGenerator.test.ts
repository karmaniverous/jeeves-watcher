/**
 * @module vcs/CommitMessageGenerator.test
 * Tests for CommitMessageGenerator with mocked Anthropic API.
 */

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitMessageGenerator } from './CommitMessageGenerator';

const silentLogger = pino({ level: 'silent' });

/** Helper to create a mock Response. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

describe('CommitMessageGenerator', () => {
  const files = ['src/index.ts', 'src/util.ts'];
  const diff = 'diff --git a/src/index.ts\n+console.log("hello")';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a commit message from the AI response', async () => {
    const generator = new CommitMessageGenerator(
      'anthropic',
      'claude-haiku-4-0',
      'test-api-key',
      silentLogger,
    );

    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, {
        content: [
          { type: 'text', text: 'Add logging to index and util modules' },
        ],
      }),
    );

    const message = await generator.generate(files, diff);

    expect(message).toBe('Add logging to index and util modules');
    expect(fetch).toHaveBeenCalledOnce();

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((options?.headers as Record<string, string>)['x-api-key']).toBe(
      'test-api-key',
    );
    expect(
      (options?.headers as Record<string, string>)['anthropic-version'],
    ).toBe('2023-06-01');

    const body = JSON.parse(options?.body as string) as Record<string, unknown>;
    expect(body.model).toBe('claude-haiku-4-0');
    expect(body.system).toContain('commit message generator');
  });

  it('returns null when no API key is configured', async () => {
    const generator = new CommitMessageGenerator(
      'anthropic',
      'claude-haiku-4-0',
      undefined,
      silentLogger,
    );

    const message = await generator.generate(files, diff);
    expect(message).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null for unsupported provider', async () => {
    const generator = new CommitMessageGenerator(
      'openai',
      'gpt-4',
      'test-key',
      silentLogger,
    );

    const message = await generator.generate(files, diff);
    expect(message).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null on non-OK API response', async () => {
    const generator = new CommitMessageGenerator(
      'anthropic',
      'claude-haiku-4-0',
      'test-api-key',
      silentLogger,
    );

    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(429, { error: { message: 'Rate limited' } }),
    );

    const message = await generator.generate(files, diff);
    expect(message).toBeNull();
  });

  it('returns null when API returns no text content', async () => {
    const generator = new CommitMessageGenerator(
      'anthropic',
      'claude-haiku-4-0',
      'test-api-key',
      silentLogger,
    );

    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(200, { content: [] }));

    const message = await generator.generate(files, diff);
    expect(message).toBeNull();
  });

  it('returns null on fetch error (timeout/network)', async () => {
    const generator = new CommitMessageGenerator(
      'anthropic',
      'claude-haiku-4-0',
      'test-api-key',
      silentLogger,
    );

    vi.mocked(fetch).mockRejectedValueOnce(
      new Error('AbortError: signal timed out'),
    );

    const message = await generator.generate(files, diff);
    expect(message).toBeNull();
  });

  it('truncates messages longer than 100 characters', async () => {
    const generator = new CommitMessageGenerator(
      'anthropic',
      'claude-haiku-4-0',
      'test-api-key',
      silentLogger,
    );

    const longMessage = 'A'.repeat(150);
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, {
        content: [{ type: 'text', text: longMessage }],
      }),
    );

    const message = await generator.generate(files, diff);
    expect(message).toHaveLength(100);
  });

  it('truncates diff to 4000 characters', async () => {
    const generator = new CommitMessageGenerator(
      'anthropic',
      'claude-haiku-4-0',
      'test-api-key',
      silentLogger,
    );

    const largeDiff = 'X'.repeat(8000);

    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, {
        content: [{ type: 'text', text: 'Update large file' }],
      }),
    );

    await generator.generate(files, largeDiff);

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    ) as { messages: Array<{ content: string }> };
    const userContent = body.messages[0].content;
    // The diff portion should be truncated to 4000 chars
    expect(userContent.length).toBeLessThan(8000);
  });
});
