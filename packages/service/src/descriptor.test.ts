/**
 * @module descriptor.test
 * Tests for the watcher component descriptor.
 */

import { Command } from '@commander-js/extra-typings';
import { jeevesComponentDescriptorSchema } from '@karmaniverous/jeeves';
import { describe, expect, it } from 'vitest';

import { watcherDescriptor } from './descriptor';

describe('watcherDescriptor', () => {
  it('validates against the component descriptor schema', () => {
    expect(() =>
      jeevesComponentDescriptorSchema.parse(watcherDescriptor),
    ).not.toThrow();
  });

  it('has correct identity and config fields', () => {
    expect(watcherDescriptor.name).toBe('watcher');
    expect(watcherDescriptor.defaultPort).toBe(1936);
    expect(watcherDescriptor.configFileName).toBe('config.json');
    expect(watcherDescriptor.sectionId).toBe('Watcher');
    expect(watcherDescriptor.refreshIntervalSeconds).toBe(71);
    expect(watcherDescriptor.servicePackage).toBe(
      '@karmaniverous/jeeves-watcher',
    );
    expect(watcherDescriptor.pluginPackage).toBe(
      '@karmaniverous/jeeves-watcher-openclaw',
    );
  });

  it('initTemplate returns a non-empty config skeleton', () => {
    const template = watcherDescriptor.initTemplate();
    expect(template).toBeDefined();
    expect(typeof template).toBe('object');
  });

  it('startCommand produces a valid node invocation', () => {
    const args = watcherDescriptor.startCommand('/path/to/config.json');
    expect(args[0]).toBe('node');
    expect(args).toContain('start');
    expect(args).toContain('-c');
    expect(args).toContain('/path/to/config.json');
  });

  it('customMerge merges inference rules by name', () => {
    const merge = watcherDescriptor.customMerge;
    expect(merge).toBeDefined();

    const target = {
      inferenceRules: [{ name: 'rule-a', match: {} }],
      other: 'kept',
    };
    const source = {
      inferenceRules: [{ name: 'rule-b', match: {} }],
    };

    const result = merge!(
      target as Record<string, unknown>,
      source as Record<string, unknown>,
    );
    const rules = result['inferenceRules'] as { name: string }[];
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.name)).toContain('rule-a');
    expect(rules.map((r) => r.name)).toContain('rule-b');
  });

  it('customCliCommands registers domain-specific commands', () => {
    const program = new Command();
    watcherDescriptor.customCliCommands?.(program as never);

    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('search');
    expect(commandNames).toContain('enrich');
    expect(commandNames).toContain('scan');
    expect(commandNames).toContain('reindex');
    expect(commandNames).toContain('rebuild-metadata');
    expect(commandNames).toContain('issues');
    expect(commandNames).toContain('helpers');
    expect(commandNames).toHaveLength(7);
  });
});
