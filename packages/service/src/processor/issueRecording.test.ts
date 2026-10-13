/**
 * @module processor/issueRecording.test
 * Unit tests for typed processing-failure tagging, file error handling and issue clearing (#255).
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { IssueRecord } from '../issues';
import {
  clearIssuesOnUnchanged,
  handleFailures,
  ProcessingFailure,
  type ProcessorIssues,
  recordRuleErrors,
  reportFailure,
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

describe('handleFailures', () => {
  const context = {
    key: 'a.md',
    operation: 'Failed to process file',
    issueType: 'extraction_error' as const,
  };

  it('returns the result and records nothing on success', async () => {
    const issues = makeIssues();
    const result = await handleFailures(
      { logger, issuesManager: asIssues(issues) },
      context,
      () => Promise.resolve('ok'),
      { fallback: 'fallback' },
    );
    expect(result).toBe('ok');
    expect(issues.record).not.toHaveBeenCalled();
  });

  it('records the fallback code for an untagged failure, replacing old issues', async () => {
    const issues = makeIssues();
    const result = await handleFailures(
      { logger, issuesManager: asIssues(issues) },
      context,
      () => Promise.reject(new Error('read fail')),
      { fallback: 'fallback' },
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
    await handleFailures(
      { logger, issuesManager: asIssues(issues) },
      context,
      () => Promise.reject(new ProcessingFailure('upsert_error', 'down')),
      { fallback: undefined },
    );
    expect(issues.record.mock.calls[0]?.[1]).toBe('upsert_error');
  });

  it('records the context rule and the failure details', () => {
    const issues = makeIssues();
    const details = [{ keyword: 'required', instancePath: '/json' }];
    const reported = reportFailure(
      { logger, issuesManager: asIssues(issues) },
      { key: 'app://x', operation: 'op', rule: 'chat' },
      new ProcessingFailure('match_failed', 'no match', details),
    );
    expect(reported).toEqual({
      type: 'match_failed',
      message: 'no match',
      details,
    });
    expect(issues.record).toHaveBeenCalledWith(
      'app://x',
      'match_failed',
      'no match',
      { operation: 'op', rule: 'chat', details },
    );
  });

  it('only logs when no fallback code is given and the failure is untagged', async () => {
    const issues = makeIssues();
    const error = vi.spyOn(logger, 'error');
    await handleFailures(
      { logger, issuesManager: asIssues(issues) },
      { key: 'a.md', operation: 'Failed to delete file' },
      () => Promise.reject(new Error('gone')),
      { fallback: undefined },
    );
    expect(issues.record).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('logs without recording when there is no issues store', async () => {
    const error = vi.spyOn(logger, 'error');
    await expect(
      handleFailures(
        { logger },
        context,
        () => Promise.reject(new Error('x')),
        { fallback: null },
      ),
    ).resolves.toBeNull();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[1]).toBe(context.operation);
    error.mockRestore();
  });
});

describe('recordRuleErrors', () => {
  const errors = [
    { rule: 'r', stage: 'template' as const, message: 'boom' },
    { rule: 'r', stage: 'render' as const, message: 'bang' },
  ];
  const message =
    'Rule "r" template failed: boom; Rule "r" render failed: bang';
  const upsert: IssueRecord = {
    type: 'upsert_error',
    message: 'partial',
    timestamp: 1,
  };

  it('records one interpolation_error without clearing other issues', () => {
    const issues = makeIssues([upsert]);
    recordRuleErrors(asIssues(issues), 'a.md', errors);
    expect(issues.clear).not.toHaveBeenCalled();
    expect(issues.record).toHaveBeenCalledWith(
      'a.md',
      'interpolation_error',
      message,
      { operation: 'Rule interpolation', rules: ['r'], details: errors },
    );
  });

  it('does not record an identical interpolation issue twice', () => {
    const issues = makeIssues([
      upsert,
      { type: 'interpolation_error', message, timestamp: 1 },
    ]);
    recordRuleErrors(asIssues(issues), 'a.md', errors);
    expect(issues.record).not.toHaveBeenCalled();
  });

  it('records an interpolation issue whose message changed', () => {
    const issues = makeIssues([
      { type: 'interpolation_error', message: 'older', timestamp: 1 },
    ]);
    recordRuleErrors(asIssues(issues), 'a.md', errors);
    expect(issues.record).toHaveBeenCalledOnce();
  });

  it('records nothing without errors or without a store', () => {
    const issues = makeIssues();
    recordRuleErrors(asIssues(issues), 'a.md', []);
    recordRuleErrors(asIssues(issues), 'a.md', undefined);
    expect(issues.get).not.toHaveBeenCalled();
    expect(issues.record).not.toHaveBeenCalled();
    expect(() => {
      recordRuleErrors(undefined, 'a.md', errors);
    }).not.toThrow();
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
