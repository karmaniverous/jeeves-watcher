/**
 * @module api
 *
 * Small fetch wrapper for jeeves-watcher CLI commands.
 */

function apiBase(host: string, port: string): string {
  return `http://${host}:${port}`;
}

/**
 * Call the jeeves-watcher HTTP API.
 *
 * @param host - API host.
 * @param port - API port.
 * @param method - HTTP method.
 * @param path - Request path.
 * @param body - Optional JSON body.
 * @returns Response body as text.
 */
export async function apiCall(
  host: string,
  port: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<string> {
  const url = `${apiBase(host, port)}${path}`;
  const headers: Record<string, string> = {};

  const init: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(text || `HTTP ${String(res.status)}`);
  }

  return text;
}
