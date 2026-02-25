/**
 * @module util/logger.test
 * Tests for logger fallback helper.
 */

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLogger } from './logger';

describe('getLogger', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return pino logger when provided', () => {
    const logger = pino({ level: 'silent' });
    const result = getLogger(logger);

    expect(result).toBe(logger);
  });

  it('should return console-based logger when no pino logger provided', () => {
    const logger = getLogger();

    expect(logger).toBeDefined();
    expect(typeof logger.warn).toBe('function');
  });

  it('should call console.warn with both obj and msg', () => {
    const logger = getLogger();
    const obj = { foo: 'bar' };
    const msg = 'warning message';

    logger.warn(obj, msg);

    expect(consoleWarnSpy).toHaveBeenCalledWith(obj, msg);
  });

  it('should call console.warn with obj only when no message', () => {
    const logger = getLogger();
    const obj = { foo: 'bar' };

    logger.warn(obj);

    expect(consoleWarnSpy).toHaveBeenCalledWith(obj);
  });

  it('should handle undefined logger parameter', () => {
    const logger = getLogger(undefined);

    expect(logger).toBeDefined();
    expect(typeof logger.warn).toBe('function');

    logger.warn({ test: 'data' }, 'test message');
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});
