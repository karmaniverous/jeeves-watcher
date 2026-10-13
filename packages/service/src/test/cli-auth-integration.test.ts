/**
 * @module test/cli-auth-integration.test
 * Service integration (requires Qdrant): the CLI's API commands against the real Fastify API listening on 127.0.0.1 with api.apiKey set: authenticated requests succeed, unauthenticated ones get 401.
 */

import { createServiceCli } from '@karmaniverous/jeeves';
import { API_KEY_ENV_VAR } from '@karmaniverous/jeeves-watcher-core';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { cliUnauthorizedMessage } from '../cli/jeeves-watcher/apiClient';
import { watcherDescriptor } from '../descriptor';
import { qdrantAvailable } from './harness/qdrant';
import { type ServiceHarness, startServiceHarness } from './harness/service';

const API_KEY = 'cli-integration-test-key';

/** Output and exit code of one CLI run. */
interface CliRun {
  stdout: string;
  stderr: string;
  exitCode: typeof process.exitCode;
}

describe.skipIf(!qdrantAvailable())(
  'CLI integration: API bearer key (requires Qdrant)',
  () => {
    let harness: ServiceHarness;
    let hostPort: string[];
    let port: string;

    beforeAll(async () => {
      harness = await startServiceHarness({
        label: 'cli_auth',
        apiKey: API_KEY,
        listen: true,
      });
      const url = new URL(harness.baseUrl!);
      port = url.port;
      hostPort = ['--host', url.hostname, '--port', port];
    });

    afterAll(async () => {
      await harness.close();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      process.exitCode = undefined;
    });

    /**
     * Run the real service CLI (core commands + watcher commands + shared API
     * client). `target` addresses the harness (core `config` takes no --host).
     */
    async function runCli(
      args: string[],
      target: string[] = hostPort,
    ): Promise<CliRun> {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cli = createServiceCli(watcherDescriptor).exitOverride();
      await cli.parseAsync(['node', 'jeeves-watcher', ...args, ...target]);
      const exitCode = process.exitCode;
      process.exitCode = undefined;
      return {
        stdout: log.mock.calls.flat().map(String).join('\n'),
        stderr: err.mock.calls.flat().map(String).join('\n'),
        exitCode,
      };
    }

    it('succeeds with --api-key', async () => {
      const run = await runCli(['issues', '--api-key', API_KEY]);
      expect(run.exitCode).toBeUndefined();
      expect(run.stderr).toBe('');
      expect(JSON.parse(run.stdout)).toBeTypeOf('object');
    });

    it('succeeds with JEEVES_WATCHER_API_KEY on a POST route', async () => {
      vi.stubEnv(API_KEY_ENV_VAR, API_KEY);
      const run = await runCli(['scan', '--limit', '1']);
      expect(run.exitCode).toBeUndefined();
      expect(JSON.parse(run.stdout)).toMatchObject({ points: [] });
    });

    it('core config query succeeds with the key and gets 401 without', async () => {
      const target = ['--port', port];
      const ok = await runCli(
        ['config', '$.search', '--api-key', API_KEY],
        target,
      );
      expect(ok.exitCode).toBeUndefined();
      expect(JSON.parse(ok.stdout)).toHaveProperty('result');

      const denied = await runCli(['config'], target);
      expect(denied.exitCode).toBe(1);
      expect(denied.stderr).toBe(
        `Config query failed: ${cliUnauthorizedMessage(false)}`,
      );
    });

    it('gets 401 with guidance when no key is supplied', async () => {
      const run = await runCli(['issues']);
      expect(run.exitCode).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toBe(cliUnauthorizedMessage(false));
    });

    it('gets 401 for a wrong key and never prints it', async () => {
      const run = await runCli(['issues', '--api-key', 'wrong-key']);
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toBe(cliUnauthorizedMessage(true));
      expect(`${run.stdout}${run.stderr}`).not.toContain('wrong-key');
    });
  },
);
