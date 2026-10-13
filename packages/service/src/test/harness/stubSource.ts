/**
 * @module test/harness/stubSource
 * Tiny stub HTTP source server for integration tests: serves canned responses by path (status, content type, body, headers, delay or manual release) on 127.0.0.1 and records requests.
 */

import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

/** A canned response. Defaults: 200, `application/json`, no delay. */
export interface StubResponse {
  /** HTTP status code (default 200). */
  status?: number;
  /** Body: strings are sent verbatim, anything else is JSON-encoded. */
  body?: unknown;
  /** `Content-Type` header (default `application/json`). */
  contentType?: string;
  /** Extra response headers. */
  headers?: Record<string, string>;
  /** Delay before responding, in milliseconds. */
  delayMs?: number;
  /** Hold the response until this promise settles (manual release). */
  until?: Promise<unknown>;
}

/** A request received by the stub. */
export interface StubRequest {
  /** HTTP method. */
  method: string;
  /** Raw request URL (path plus query, not decoded). */
  url: string;
  /** Raw path (query stripped, not decoded); the route key. */
  path: string;
  /** Request headers. */
  headers: IncomingHttpHeaders;
  /** Raw request body. */
  body: string;
}

/** A route handler: a canned response or a function producing one. */
export type StubRoute = StubResponse | ((request: StubRequest) => StubResponse);

/** Response for paths with no route. */
export const STUB_NOT_FOUND: StubResponse = {
  status: 404,
  body: { error: 'not found' },
};

/** A running stub source server. */
export interface StubSourceServer {
  /** Base URL, e.g. `http://127.0.0.1:54321` (no trailing slash). */
  url: string;
  /** Requests received so far, in arrival order. */
  requests: StubRequest[];
  /** Set (or replace) the route for a raw path. */
  route: (path: string, response: StubRoute) => void;
  /** Remove all routes and recorded requests. */
  reset: () => void;
  /** Stop the server, dropping any in-flight (delayed) responses. */
  close: () => Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) data += String(chunk);
  return data;
}

function send(res: ServerResponse, response: StubResponse): void {
  if (res.destroyed) return;
  const body =
    response.body === undefined
      ? ''
      : typeof response.body === 'string'
        ? response.body
        : JSON.stringify(response.body);
  res.writeHead(response.status ?? 200, {
    'content-type': response.contentType ?? 'application/json',
    ...response.headers,
  });
  res.end(body);
}

/**
 * Start a stub source server on an ephemeral port.
 *
 * @param routes - Initial routes keyed by raw path.
 * @returns The running server.
 */
export async function startStubSourceServer(
  routes: Record<string, StubRoute> = {},
): Promise<StubSourceServer> {
  const table = new Map<string, StubRoute>(Object.entries(routes));
  const requests: StubRequest[] = [];
  const timers = new Set<NodeJS.Timeout>();

  const server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const url = req.url ?? '/';
      const request: StubRequest = {
        method: req.method ?? 'GET',
        url,
        path: url.split('?', 1)[0],
        headers: req.headers,
        body,
      };
      requests.push(request);
      const route = table.get(request.path) ?? STUB_NOT_FOUND;
      const response = typeof route === 'function' ? route(request) : route;
      if (response.until) {
        const respond = () => {
          send(res, response);
        };
        void response.until.then(respond, respond);
        return;
      }
      if (!response.delayMs) {
        send(res, response);
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        send(res, response);
      }, response.delayMs);
      timers.add(timer);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    route: (path, response) => {
      table.set(path, response);
    },
    reset: () => {
      table.clear();
      requests.length = 0;
    },
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
