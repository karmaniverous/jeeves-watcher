/**
 * @module api/mergedDocument
 * Builds a merged virtual document from config, values, and issues for JSONPath querying.
 */

import { readFileSync } from 'node:fs';

import type { JeevesWatcherConfig } from '../config/types';
import type { AllHelpersIntrospection } from '../helpers';
import type { IssuesManager } from '../issues';
import type { ValuesManager } from '../values';

/** Options for building the merged document. */
export interface BuildMergedDocumentOptions {
  config: JeevesWatcherConfig;
  valuesManager: ValuesManager;
  issuesManager: IssuesManager;
  helperExports?: Record<string, unknown>;
  helperIntrospection?: AllHelpersIntrospection;
}

/**
 * Build a helper section for the merged document, injecting introspection exports per namespace.
 */
function buildHelperSection(
  configHelpers:
    | Record<string, { path: string; description?: string }>
    | undefined,
  legacyExports: Record<string, unknown> | undefined,
  introspection:
    | Record<string, { exports: Record<string, string> }>
    | undefined,
): Record<string, unknown> {
  if (!configHelpers) return {};

  const result: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(configHelpers)) {
    result[name] = {
      ...entry,
      ...(introspection?.[name]?.exports
        ? { exports: introspection[name].exports }
        : {}),
    };
  }

  if (legacyExports) {
    result['_exports'] = legacyExports;
  }

  return result;
}

/**
 * Safely read and parse a file reference. Returns the original string on failure.
 */
function readFileReference(filePath: string): unknown {
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (filePath.endsWith('.json')) {
      return JSON.parse(content) as unknown;
    }
    return content;
  } catch {
    return filePath;
  }
}

/**
 * Build a merged virtual document combining config, values, and issues.
 *
 * @param options - The build options.
 * @returns The merged document object.
 */
export function buildMergedDocument(
  options: BuildMergedDocumentOptions,
): Record<string, unknown> {
  const {
    config,
    valuesManager,
    issuesManager,
    helperExports,
    helperIntrospection,
  } = options;

  const inferenceRules = (config.inferenceRules ?? []).map((rule) => ({
    ...rule,
    values: valuesManager.getForRule(rule.name),
  }));

  return {
    description: (config as Record<string, unknown>)['description'] ?? '',
    search: config.search ?? {},
    schemas: config.schemas ?? {},
    inferenceRules,
    mapHelpers: buildHelperSection(
      config.mapHelpers,
      helperExports?.mapHelpers as Record<string, unknown> | undefined,
      helperIntrospection?.mapHelpers,
    ),
    templateHelpers: buildHelperSection(
      config.templateHelpers,
      helperExports?.templateHelpers as Record<string, unknown> | undefined,
      helperIntrospection?.templateHelpers,
    ),
    maps: config.maps ?? {},
    templates: config.templates ?? {},
    slots: config.slots ?? {},
    issues: issuesManager.getAll(),
  };
}

/**
 * Resolve file references in known config reference positions only.
 *
 * Resolves strings in:
 * - `inferenceRules[*].map` when ending in `.json` (if 'files' in resolveTypes)
 * - `maps[*]` when a string (file path) (if 'files' in resolveTypes)
 * - `templates[*]` when a string (file path) (if 'files' in resolveTypes)
 * - `inferenceRules[*].schema` named references (if 'globals' in resolveTypes)
 *
 * @param doc - The document to resolve.
 * @param resolveTypes - Which resolution types to apply.
 * @returns The resolved document.
 */
export function resolveReferences(
  doc: Record<string, unknown>,
  resolveTypes: ('files' | 'globals')[],
): Record<string, unknown> {
  const resolved = { ...doc };

  // Resolve inferenceRules[*] references
  if (Array.isArray(resolved['inferenceRules'])) {
    resolved['inferenceRules'] = (
      resolved['inferenceRules'] as Record<string, unknown>[]
    ).map((rule) => {
      let updatedRule = { ...rule };

      // Resolve map file references (if 'files' requested)
      if (
        resolveTypes.includes('files') &&
        typeof rule['map'] === 'string' &&
        rule['map'].endsWith('.json')
      ) {
        updatedRule = { ...updatedRule, map: readFileReference(rule['map']) };
      }

      // Resolve schema named references (if 'globals' requested)
      if (
        resolveTypes.includes('globals') &&
        Array.isArray(rule['schema']) &&
        typeof resolved['schemas'] === 'object'
      ) {
        const globalSchemas = resolved['schemas'] as Record<string, unknown>;
        const expandedSchemas = (rule['schema'] as unknown[]).map((ref) => {
          if (typeof ref === 'string' && globalSchemas[ref]) {
            return globalSchemas[ref];
          }
          return ref;
        });
        updatedRule = { ...updatedRule, schema: expandedSchemas };
      }

      return updatedRule;
    });
  }

  // Resolve maps[*] file references (if 'files' requested)
  if (
    resolveTypes.includes('files') &&
    resolved['maps'] &&
    typeof resolved['maps'] === 'object'
  ) {
    const maps = { ...(resolved['maps'] as Record<string, unknown>) };
    for (const [key, value] of Object.entries(maps)) {
      if (typeof value === 'string') {
        maps[key] = readFileReference(value);
      }
    }
    resolved['maps'] = maps;
  }

  // Resolve templates[*] file references (if 'files' requested)
  if (
    resolveTypes.includes('files') &&
    resolved['templates'] &&
    typeof resolved['templates'] === 'object'
  ) {
    const templates = {
      ...(resolved['templates'] as Record<string, unknown>),
    };
    for (const [key, value] of Object.entries(templates)) {
      if (typeof value === 'string') {
        templates[key] = readFileReference(value);
      }
    }
    resolved['templates'] = templates;
  }

  return resolved;
}
