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
    consoleWarnSpy.mockRestore();
  });

  it('should return pino logger when provided', () => {
    const logger = pino({ level: 'silent' });
    const result = getLogger(logger);

    expect(result).toBe(logger);
  });

  it('should return console-based logger when no pino logger provided', () => {
    const result = getLogger();

    expect(result).toBeDefined();
    expect(result.warn).toBeTypeOf('function');
  });

  it('should call console.warn with both obj and msg', () => {
    const result = getLogger();
    const obj = { foo: 'bar' };
    const msg = 'warning message';

    result.warn(obj, msg);

    expect(consoleWarnSpy).toHaveBeenCalledWith(obj, msg);
  });

  it('should call console.warn with obj only when no message', () => {
    const result = getLogger();
    const obj = { foo: 'bar' };

    result.warn(obj);

    expect(consoleWarnSpy).toHaveBeenCalledWith(obj);
  });

  it('should handle undefined logger parameter', () => {
    const result = getLogger(undefined);

    expect(result).toBeDefined();
    expect(result.warn).toBeTypeOf('function');

    result.warn({ test: 'data' }, 'test message');
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});
