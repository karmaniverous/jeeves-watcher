/**
 * @module api/handlers/wrapHandler.test
 * Tests for Fastify route handler error wrapper.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { wrapHandler } from './wrapHandler';

describe('wrapHandler', () => {
  it('should execute handler successfully and return result', async () => {
    const logger = pino({ level: 'silent' });
    const mockRequest = {} as FastifyRequest;
    const sendMock = vi.fn();
    const mockReply = { send: sendMock } as unknown as FastifyReply;
    const mockResult = { success: true };

    const handler = vi.fn().mockResolvedValue(mockResult);
    const wrapped = wrapHandler(handler, logger, 'test');

    await wrapped(mockRequest, mockReply);

    expect(handler).toHaveBeenCalledWith(mockRequest, mockReply);
    expect(sendMock).toHaveBeenCalledWith(mockResult);
  });

  it('should catch errors and return 500 with error message', async () => {
    const logger = pino({ level: 'silent' });
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    const mockRequest = {} as FastifyRequest;
    const statusMock = vi.fn().mockReturnThis();
    const sendMock = vi.fn();
    const mockReply = {
      status: statusMock,
      send: sendMock,
    } as unknown as FastifyReply;

    const testError = new Error('Test error');
    const handler = vi.fn().mockRejectedValue(testError);
    const wrapped = wrapHandler(handler, logger, 'TestOperation');

    await wrapped(mockRequest, mockReply);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(sendMock).toHaveBeenCalledWith({ error: 'Internal server error' });
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: testError }),
      'TestOperation failed',
    );
  });

  it('should normalize non-Error throws', async () => {
    const logger = pino({ level: 'silent' });
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    const mockRequest = {} as FastifyRequest;
    const statusMock = vi.fn().mockReturnThis();
    const sendMock = vi.fn();
    const mockReply = {
      status: statusMock,
      send: sendMock,
    } as unknown as FastifyReply;

    const handler = vi.fn().mockRejectedValue('string error');
    const wrapped = wrapHandler(handler, logger, 'TestOp');

    await wrapped(mockRequest, mockReply);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: 'string error',
        }) as unknown,
      }),
      'TestOp failed',
    );
  });
});
