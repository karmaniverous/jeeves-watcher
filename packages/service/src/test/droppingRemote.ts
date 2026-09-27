/**
 * @module test/droppingRemote
 * Local TCP server that accepts connections and drops them immediately.
 *
 * Gives git a remote that fails in milliseconds with no network access and no
 * chance of reaching a credential prompt (much faster on Windows than a
 * refused port, which retries for ~2 s).
 */

import { createServer, type Socket } from 'node:net';

/** A running dropping remote. */
export interface DroppingRemote {
  /** Build an HTTPS remote URL on this server. */
  url: (path?: string) => string;
  /** Stop the server and destroy any open sockets. */
  close: () => Promise<void>;
}

/**
 * Start a dropping remote on an ephemeral loopback port.
 *
 * @returns The running remote.
 */
export async function startDroppingRemote(): Promise<DroppingRemote> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.destroy();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: (path = '/repo.git') => `https://127.0.0.1:${String(port)}${path}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}
