/**
 * @module test/qdrant/ports
 * Port helpers for the throwaway test Qdrant: ask the OS for a free 127.0.0.1 port, and parse `docker port` output into a host port.
 * {@link findFreePort} binds a socket briefly; {@link parseDockerPort} is pure.
 */

import { createServer } from 'node:net';

/**
 * Ask the OS for a currently free TCP port on 127.0.0.1.
 *
 * @returns The port (released again before returning).
 */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        if (port > 0) resolve(port);
        else reject(new Error('OS did not assign a port'));
      });
    });
  });
}

/**
 * Parse the host port from `docker port <container> 6333/tcp` output, which
 * lists one `host:port` mapping per line (IPv4 and/or IPv6, e.g.
 * `127.0.0.1:49153` or `[::]:49153`).
 *
 * @param output - Raw command output.
 * @returns The first mapped host port.
 * @throws When no mapping can be parsed.
 */
export function parseDockerPort(output: string): number {
  for (const line of output.split(/\r?\n/)) {
    const match = /:(\d+)\s*$/.exec(line.trim());
    if (match) {
      const port = Number(match[1]);
      if (port > 0 && port < 65536) return port;
    }
  }
  throw new Error(`Cannot parse docker port output: ${JSON.stringify(output)}`);
}
