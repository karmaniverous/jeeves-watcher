/**
 * @module config/loadConfig.embeddingDefaults.test
 * Embedding rate-limit defaults through loadConfig: an unset `embedding.rateLimitPerMinute` loads as 4000 and lets 3940 indexing items (texts) through per minute in the shared limiter (60 reserved for search); an explicit `0` is kept (no limit). Writes temp config files.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RateLimitedEmbeddingProvider } from '../embedding/rateLimitedProvider';
import type { EmbeddingProvider } from '../embedding/types';
import { EMBEDDING_DEFAULTS } from './defaults';
import { loadConfig } from './loadConfig';

const dirs: string[] = [];

/** Write a minimal config with the given embedding section and load it. */
async function load(embedding: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'jw-cfg-rate-'));
  dirs.push(dir);
  const cfgPath = join(dir, 'jeeves-watcher.config.json');
  await writeFile(
    cfgPath,
    JSON.stringify({
      watch: { paths: ['**/*.md'] },
      embedding,
      vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
    }),
    'utf8',
  );
  return loadConfig(cfgPath);
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('embedding.rateLimitPerMinute defaults', () => {
  it('defaults to 4000 per minute when unset', async () => {
    expect(EMBEDDING_DEFAULTS.rateLimitPerMinute).toBe(4000);
    const config = await load({ provider: 'mock', model: 'm' });
    expect(config.embedding.rateLimitPerMinute).toBe(4000);
  });

  it('the loaded default lets 3940 indexing texts through in a minute (4000 less the search reserve of 60), then waits for the window', async () => {
    const config = await load({ provider: 'mock', model: 'm' });
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const embed = vi.fn((texts: string[]) =>
      Promise.resolve(texts.map(() => [0])),
    );
    const inner: EmbeddingProvider = { dimensions: 1, embed };
    const limited = new RateLimitedEmbeddingProvider(inner, {
      rateLimitPerMinute: config.embedding.rateLimitPerMinute,
      maxBackoffMs: 60_000,
    });

    const batch = Array.from({ length: 100 }, () => 'a');
    await Promise.all(
      Array.from({ length: 39 }, () => limited.embed(batch)).concat(
        limited.embed(batch.slice(0, 40)),
      ),
    );
    expect(embed).toHaveBeenCalledTimes(40);

    // 3940 texts are in the window: the next indexing text waits until they
    // leave it, while a search query uses the reserve at once.
    const next = limited.embed(['b']);
    await limited.embed(['q'], { interactive: true });
    expect(embed).toHaveBeenCalledTimes(41);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(embed).toHaveBeenCalledTimes(41);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(embed).toHaveBeenCalledTimes(42);
  });

  // That 0 disables limiting: rateLimitedProvider.test.ts.
  it('keeps an explicit rateLimitPerMinute of 0 instead of the default', async () => {
    const config = await load({
      provider: 'mock',
      model: 'm',
      rateLimitPerMinute: 0,
    });
    expect(config.embedding.rateLimitPerMinute).toBe(0);
  });
});
