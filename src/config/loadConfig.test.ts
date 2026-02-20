import { expect, suite, test } from 'vitest';

suite('loadConfig', () => {
  test('should be importable', async () => {
    const { loadConfig } = await import('./loadConfig');
    expect(loadConfig).toBeDefined();
  });
});
