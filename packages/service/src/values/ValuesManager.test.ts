import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ValuesManager } from './ValuesManager';

describe('ValuesManager', () => {
  let tempDir: string;
  let manager: ValuesManager;
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'values-test-'));
    manager = new ValuesManager(tempDir, logger);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts empty', () => {
    expect(manager.getAll()).toEqual({});
  });

  it('tracks string values', () => {
    manager.update('rule-a', { category: 'docs' });
    manager.update('rule-a', { category: 'api' });
    expect(manager.getForRule('rule-a')).toEqual({
      category: ['api', 'docs'],
    });
  });

  it('tracks number and boolean values', () => {
    manager.update('rule-a', { priority: 3, active: true });
    manager.update('rule-a', { priority: 1, active: false });
    expect(manager.getForRule('rule-a')).toEqual({
      priority: [1, 3],
      active: [false, true],
    });
  });

  it('skips objects, arrays, and null', () => {
    manager.update('rule-a', {
      obj: { nested: true },
      arr: [1, 2],
      nil: null,
      ok: 'yes',
    });
    expect(manager.getForRule('rule-a')).toEqual({ ok: ['yes'] });
  });

  it('deduplicates values', () => {
    manager.update('rule-a', { x: 'a' });
    manager.update('rule-a', { x: 'a' });
    expect(manager.getForRule('rule-a')).toEqual({ x: ['a'] });
  });

  it('clearAll wipes everything', () => {
    manager.update('rule-a', { x: 'a' });
    manager.clearAll();
    expect(manager.getAll()).toEqual({});
  });

  it('persists across instances', () => {
    manager.update('rule-a', { x: 'val' });
    const manager2 = new ValuesManager(tempDir, logger);
    expect(manager2.getForRule('rule-a')).toEqual({ x: ['val'] });
  });

  it('returns empty for unknown rule', () => {
    expect(manager.getForRule('nonexistent')).toEqual({});
  });
});
