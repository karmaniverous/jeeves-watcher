/**
 * @module app/initialization.test
 * Tests for app initialization utilities.
 */

import { describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { getConfigDir, resolveMapsConfig } from './initialization';

describe('resolveMapsConfig', () => {
  it('should return undefined for undefined input', () => {
    expect(resolveMapsConfig(undefined)).toBeUndefined();
  });

  it('should handle string values (file paths)', () => {
    const result = resolveMapsConfig({
      map1: './maps/transform.json',
    });

    expect(result).toEqual({
      map1: './maps/transform.json',
    });
  });

  it('should handle plain JsonMapMap objects', () => {
    const mapObj = { transformations: [{ op: 'move', from: 'a', to: 'b' }] };
    const result = resolveMapsConfig({
      map1: mapObj,
    });

    expect(result).toEqual({ map1: mapObj });
  });

  it('should extract map from { map, description } wrapper', () => {
    const mapObj = { transformations: [] };
    const result = resolveMapsConfig({
      map1: { map: mapObj, description: 'Test map' },
    });

    expect(result).toEqual({ map1: mapObj });
  });

  it('should handle mixed map types', () => {
    const mapObj = { transformations: [] };
    const result = resolveMapsConfig({
      fileMap: './maps/file.json',
      inlineMap: mapObj,
      wrappedMap: { map: './maps/wrapped.json', description: 'Wrapped' },
    });

    expect(result).toEqual({
      fileMap: './maps/file.json',
      inlineMap: mapObj,
      wrappedMap: './maps/wrapped.json',
    });
  });
});

describe('getConfigDir', () => {
  it('should return directory from config path', () => {
    expect(getConfigDir('/path/to/config.json')).toBe('/path/to');
    expect(getConfigDir('C:\\configs\\jeeves.yaml')).toBe('C:\\configs');
  });

  it('should return "." when no config path provided', () => {
    expect(getConfigDir()).toBe('.');
    expect(getConfigDir(undefined)).toBe('.');
  });
});

describe('initialization helpers integration', () => {
  it('should create processor config with resolved maps', async () => {
    const { createProcessorConfig } = await import('./initialization');

    const config: Partial<JeevesWatcherConfig> = {
      embedding: {
        provider: 'gemini',
        model: 'test-model',
        chunkSize: 500,
        chunkOverlap: 100,
      },
      maps: {
        transform1: { transformations: [] },
      },
      schemas: {},
    };

    const processorConfig = createProcessorConfig(
      config as JeevesWatcherConfig,
      '/config/dir',
      undefined,
    );

    expect(processorConfig.chunkSize).toBe(500);
    expect(processorConfig.chunkOverlap).toBe(100);
    expect(processorConfig.configDir).toBe('/config/dir');
    expect(processorConfig.maps).toBeDefined();
  });
});
