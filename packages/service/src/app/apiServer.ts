/**
 * @module app/apiServer
 * Creates the HTTP API server through the component factory and starts listening on the configured host and port (defaults from the shared Jeeves port map). Network I/O.
 */

import { DEFAULT_PORTS, getBindAddress } from '@karmaniverous/jeeves';
import type { FastifyInstance } from 'fastify';

import type { JeevesWatcherConfig } from '../config/types';
import type { JeevesWatcherFactories } from './factories';

/** Options passed to the `createApiServer` factory. */
export type ApiServerOptions = Parameters<
  JeevesWatcherFactories['createApiServer']
>[0];

/**
 * Create the API server and start listening.
 *
 * @param createApiServer - The API server factory.
 * @param options - Server options (components and stores).
 * @param config - The startup config (`api.host`, `api.port`).
 * @returns The listening server.
 */
export async function startApiServer(
  createApiServer: JeevesWatcherFactories['createApiServer'],
  options: ApiServerOptions,
  config: JeevesWatcherConfig,
): Promise<FastifyInstance> {
  const server = createApiServer(options);
  await server.listen({
    host: config.api?.host ?? getBindAddress('watcher'),
    port: config.api?.port ?? DEFAULT_PORTS.watcher,
  });
  return server;
}
