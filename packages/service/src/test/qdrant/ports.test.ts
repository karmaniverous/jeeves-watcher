/**
 * @module test/qdrant/ports.test
 * Tests for free-port discovery and `docker port` output parsing.
 */

import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { findFreePort, parseDockerPort } from './ports';

describe('parseDockerPort', () => {
  it.each([
    ['127.0.0.1:49153\n', 49153],
    ['0.0.0.0:32768\n[::]:32768\n', 32768],
    ['[::]:40001', 40001],
    ['\r\n127.0.0.1:5000\r\n', 5000],
  ])('parses %j', (output, port) => {
    expect(parseDockerPort(output)).toBe(port);
  });

  it.each(['', 'Error: No public port', '127.0.0.1:0', '127.0.0.1:70000'])(
    'rejects %j',
    (output) => {
      expect(() => parseDockerPort(output)).toThrow(/Cannot parse/);
    },
  );
});

describe('findFreePort', () => {
  it('returns a port that can be bound', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.close(() => {
          resolve();
        });
      });
    });
  });
});
