/**
 * @module api/handlers/status
 * Fastify route handler for GET /status. Pure handler: returns process uptime and health.
 */

/**
 * Create handler for GET /status.
 */
export function createStatusHandler(): () => {
  status: string;
  uptime: number;
} {
  return () => ({
    status: 'ok',
    uptime: process.uptime(),
  });
}
