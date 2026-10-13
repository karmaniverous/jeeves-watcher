/**
 * @module api/handlers/wrapHandler.test
 * Tests for the Fastify route handler error wrapper: results are sent, RequestErrors keep their status and code, and any other error becomes a generic 500 without its message.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { invalidRequest, RequestError } from '../requestError';
import { wrapHandler } from './wrapHandler';

const GENERIC_500 = {
  code: 'internal_error',
  error: 'Internal Server Error',
  message: 'Internal server error',
};

/** A reply mock recording status and body. */
function mockReply() {
  const statusMock = vi.fn().mockReturnThis();
  const sendMock = vi.fn();
  const reply = {
    status: statusMock,
    send: sendMock,
    sent: false,
  } as unknown as FastifyReply;
  return { reply, statusMock, sendMock };
}

describe('wrapHandler', () => {
  it('should execute handler successfully and return result', async () => {
    const logger = pino({ level: 'silent' });
    const mockRequest = {} as FastifyRequest;
    const { reply, sendMock } = mockReply();
    const mockResult = { success: true };

    const handler = vi.fn().mockResolvedValue(mockResult);
    const wrapped = wrapHandler(handler, logger, 'test');

    await wrapped(mockRequest, reply);

    expect(handler).toHaveBeenCalledWith(mockRequest, reply);
    expect(sendMock).toHaveBeenCalledWith(mockResult);
  });

  it('logs an unexpected error and sends a generic 500', async () => {
    const logger = pino({ level: 'silent' });
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    const { reply, statusMock, sendMock } = mockReply();

    const testError = new Error('secret internal detail');
    const handler = vi.fn().mockRejectedValue(testError);
    const wrapped = wrapHandler(handler, logger, 'TestOperation');

    await wrapped({} as FastifyRequest, reply);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(sendMock).toHaveBeenCalledWith(GENERIC_500);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: testError }),
      'TestOperation failed',
    );
  });

  it('should normalize non-Error throws', async () => {
    const logger = pino({ level: 'silent' });
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    const { reply, statusMock, sendMock } = mockReply();

    const handler = vi.fn().mockRejectedValue('string error');
    const wrapped = wrapHandler(handler, logger, 'TestOp');

    await wrapped({} as FastifyRequest, reply);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(sendMock).toHaveBeenCalledWith(GENERIC_500);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: 'string error',
        }) as unknown,
      }),
      'TestOp failed',
    );
  });

  it.each([
    [
      'invalid_request',
      invalidRequest('bad', { details: [1] }),
      400,
      { code: 'invalid_request', error: 'bad', details: [1] },
    ],
    [
      'not_found',
      new RequestError(404, 'not_found', 'Path not found: x'),
      404,
      { code: 'not_found', error: 'Path not found: x' },
    ],
  ])(
    'sends a RequestError (%s) with its status',
    async (_l, err, status, body) => {
      const logger = pino({ level: 'silent' });
      const loggerErrorSpy = vi.spyOn(logger, 'error');
      const { reply, statusMock, sendMock } = mockReply();

      await wrapHandler(
        () => Promise.reject(err),
        logger,
        'Op',
      )({} as FastifyRequest, reply);

      expect(statusMock).toHaveBeenCalledWith(status);
      expect(sendMock).toHaveBeenCalledWith(body);
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    },
  );
});
