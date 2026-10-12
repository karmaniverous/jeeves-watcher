/**
 * @module processor/issueRecording.test
 * Unit tests for typed processing-failure tagging, file error handling and issue clearing (#255).
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { IssueRecord } from '../issues';
import {
  clearIssuesOnUnchanged,
  handleFileErrors,
  ProcessingFailure,
  type ProcessorIssues,
  withIssueType,
} from './issueRecording';

const logger = pino({ level: 'silent' });

function makeIssues(existing?: IssueRecord[]) {
  return {
    record: vi.fn(),
    clear: vi.fn(),
    get: vi.fn().mockReturnValue(existing),
  };
}

const asIssues = (m: ReturnType<typeof makeIssues>) =>
  m as unknown as ProcessorIssues;

describe('withIssueType', () => {
  it('returns the stage result on success', async () => {
    await expect(
      withIssueType('embedding_error', () => Promise.resolve(42)),
    ).resolves.toBe(42);
  });

  it('tags an untagged failure, keeping message and cause', async () => {
    const cause = new Error('quota');
    const err: unknown = await withIssueType('embedding_error', () =>
      Promise.reject(cause),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProcessingFailure);
    expect((err as ProcessingFailure).issueType).toBe('embedding_error');
    expect((err as ProcessingFailure).message).toBe('quota');
    expect((err as ProcessingFailure).cause).toBe(cause);
  });

  it('keeps the code of an already tagged failure', async () => {
    const inner = new ProcessingFailure('upsert_error', new Error('x'));
    const err: unknown = await withIssueType('extraction_error', () =>
      Promise.reject(inner),
    ).catch((e: unknown) => e);
    expect(err).toBe(inner);
  });

  it('stringifies a non-Error cause', () => {
    expect(new ProcessingFailure('upsert_error', 'down').message).toBe('down');
  });
});

describe('handleFileErrors', () => {
  const context = {
    filePath: 'a.md',
    operation: 'Failed to process file',
    issueType: 'extraction_error' as const,
  };

  it('returns the result and records nothing on success', async () => {
    const issues = makeIssues();
    const result = await handleFileErrors(
      { logger, issuesManager: asIssues(issues) },
      context,
      () => Promise.resolve('ok'),
      'fallback',
    );
    expect(result).toBe('ok');
    expect(issues.record).not.toHaveBeenCalled();
  });

  it('records the fallback code for an untagged failure, replacing old issues', async () => {
    const issues = makeIssues();
    const result = await handleFileErrors(
      { logger, issuesManager: asIssues(issues) },
      context,
      () => Promise.reject(new Error('read fail')),
      'fallback',
    );
    expect(result).toBe('fallback');
    expect(issues.clear).toHaveBeenCalledWith('a.md');
    expect(issues.record).toHaveBeenCalledWith(
      'a.md',
      'extraction_error',
      'read fail',
      { operation: 'Failed to process file' },
    );
  });

  it('records the tagged code in preference to the fallback', async () => {
    const issues = makeIssues();
    await handleFileErrors(
      { logger, issuesManager: asIssues(issues) },
      context,
      () => Promise.reject(new ProcessingFailure('upsert_error', 'down')),
      undefined,
    );
    expect(issues.record.mock.calls[0]?.[1]).toBe('upsert_error');
  });

  it('only logs when no fallback code is given and the failure is untagged', async () => {
    const issues = makeIssues();
    const error = vi.spyOn(logger, 'error');
    await handleFileErrors(
      { logger, issuesManager: asIssues(issues) },
      { filePath: 'a.md', operation: 'Failed to delete file' },
      () => Promise.reject(new Error('gone')),
      undefined,
    );
    expect(issues.record).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('logs without recording when there is no issues store', async () => {
    await expect(
      handleFileErrors(
        { logger },
        context,
        () => Promise.reject(new Error('x')),
        null,
      ),
    ).resolves.toBeNull();
  });
});

describe('clearIssuesOnUnchanged', () => {
  const issue = (type: IssueRecord['type']): IssueRecord => ({
    type,
    message: 'm',
    timestamp: 1,
  });

  it('clears non-upsert issues', () => {
    const issues = makeIssues([issue('extraction_error')]);
    clearIssuesOnUnchanged(asIssues(issues), 'a.md');
    expect(issues.clear).toHaveBeenCalledWith('a.md');
  });

  it('keeps an upsert_error (partial upsert may leave a matching hash)', () => {
    const issues = makeIssues([issue('upsert_error')]);
    clearIssuesOnUnchanged(asIssues(issues), 'a.md');
    expect(issues.clear).not.toHaveBeenCalled();
  });

  it('does nothing when the file has no issues or there is no store', () => {
    const issues = makeIssues(undefined);
    clearIssuesOnUnchanged(asIssues(issues), 'a.md');
    expect(issues.clear).not.toHaveBeenCalled();
    expect(() => {
      clearIssuesOnUnchanged(undefined, 'a.md');
    }).not.toThrow();
  });
});
