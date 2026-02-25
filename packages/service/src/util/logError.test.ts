/**
 * @module util/logError.test
 * Tests for logError utility.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { logError } from './logError';

describe('logError', () => {
  it('should log error with message and no context', () => {
    const logger = pino({ level: 'silent' });
    const errorSpy = vi.spyOn(logger, 'error');
    const testError = new Error('Test error');

    logError(logger, testError, 'Something failed');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: testError }),
      'Something failed',
    );
  });

  it('should log error with message and context', () => {
    const logger = pino({ level: 'silent' });
    const errorSpy = vi.spyOn(logger, 'error');
    const testError = new Error('Test error');
    const context = { filePath: '/test/file.txt', attempt: 3 };

    logError(logger, testError, 'File operation failed', context);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ...context, err: testError }),
      'File operation failed',
    );
  });

  it('should log error with context first, message second (overload)', () => {
    const logger = pino({ level: 'silent' });
    const errorSpy = vi.spyOn(logger, 'error');
    const testError = new Error('Test error');
    const context = { operation: 'upsert' };

    logError(logger, testError, context, 'Database operation failed');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ...context, err: testError }),
      'Database operation failed',
    );
  });

  it('should normalize non-Error values', () => {
    const logger = pino({ level: 'silent' });
    vi.spyOn(logger, 'error');

    logError(logger, 'string error', 'Operation failed');

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'string error' }) as unknown,
      }),
      'Operation failed',
    );
  });

  it('should handle empty context', () => {
    const logger = pino({ level: 'silent' });
    const errorSpy = vi.spyOn(logger, 'error');
    const testError = new Error('Test error');
    const emptyContext: Record<string, unknown> = {};

    logError(logger, testError, 'Message', emptyContext);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: testError }),
      'Message',
    );
  });
});
