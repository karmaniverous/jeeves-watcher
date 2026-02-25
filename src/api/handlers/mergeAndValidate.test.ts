/**
 * @module api/handlers/mergeAndValidate.test
 * Tests for config merge and validation logic.
 */

import { describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import { mergeAndValidateConfig } from './mergeAndValidate';

describe('mergeAndValidateConfig', () => {
  const baseConfig: JeevesWatcherConfig = {
    watch: { paths: ['**/*.md'] },
    embedding: { provider: 'gemini', model: 'gemini-embedding-001' },
    vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
  };

  it('should validate and merge config without errors', () => {
    const result = mergeAndValidateConfig(baseConfig);

    expect(result.errors).toHaveLength(0);
    expect(result.parsed).toBeDefined();
    expect(result.candidateRaw).toMatchObject(baseConfig);
  });

  it('should merge partial config into base config', () => {
    const partial = {
      metadataDir: '.custom-metadata',
      logging: { level: 'debug' },
    };

    const result = mergeAndValidateConfig(baseConfig, partial);

    expect(result.errors).toHaveLength(0);
    expect(result.parsed?.metadataDir).toBe('.custom-metadata');
    expect(result.parsed?.logging?.level).toBe('debug');
    expect(result.parsed?.watch).toEqual(baseConfig.watch);
  });

  it('should return validation errors for invalid config', () => {
    const invalid = {
      watch: { paths: [] }, // Invalid: paths must have at least one element
    };

    const result = mergeAndValidateConfig(baseConfig, invalid);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.parsed).toBeUndefined();
    expect(result.errors[0]).toHaveProperty('path');
    expect(result.errors[0]).toHaveProperty('message');
  });

  it('should merge inference rules correctly', () => {
    const configWithRules: JeevesWatcherConfig = {
      ...baseConfig,
      inferenceRules: [
        {
          name: 'rule1',
          description: 'First rule',
          match: { type: 'object' },
        },
      ],
    };

    const partial = {
      inferenceRules: [
        {
          name: 'rule2',
          description: 'Second rule',
          match: { type: 'object' },
        },
      ],
    };

    const result = mergeAndValidateConfig(configWithRules, partial);

    expect(result.errors).toHaveLength(0);
    expect(result.parsed?.inferenceRules).toHaveLength(2);
    expect(result.parsed?.inferenceRules?.[0].name).toBe('rule1');
    expect(result.parsed?.inferenceRules?.[1].name).toBe('rule2');
  });

  it('should override inference rule with same name', () => {
    const configWithRules: JeevesWatcherConfig = {
      ...baseConfig,
      inferenceRules: [
        {
          name: 'sharedRule',
          description: 'Original',
          match: { type: 'object' },
        },
      ],
    };

    const partial = {
      inferenceRules: [
        {
          name: 'sharedRule',
          description: 'Updated',
          match: { type: 'object', properties: {} },
        },
      ],
    };

    const result = mergeAndValidateConfig(configWithRules, partial);

    expect(result.errors).toHaveLength(0);
    expect(result.parsed?.inferenceRules).toHaveLength(1);
    expect(result.parsed?.inferenceRules?.[0].description).toBe('Updated');
  });

  it('should handle missing partial config', () => {
    const result = mergeAndValidateConfig(baseConfig, undefined);

    expect(result.errors).toHaveLength(0);
    expect(result.parsed).toEqual(expect.objectContaining(baseConfig));
  });
});
