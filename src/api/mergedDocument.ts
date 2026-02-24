/**
 * @module api/mergedDocument
 * Builds a merged virtual document from config, values, and issues for JSONPath querying.
 */

import { readFileSync } from 'node:fs';

import type { JeevesWatcherConfig } from '../config/types';
import type { IssuesManager } from '../issues';
import type { ValuesManager } from '../values';

/** Options for building the merged document. */
export interface BuildMergedDocumentOptions {
  config: JeevesWatcherConfig;
  valuesManager: ValuesManager;
  issuesManager: IssuesManager;
  helperExports?: Record<string, unknown>;
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
  const { config, valuesManager, issuesManager, helperExports } = options;

  const inferenceRules = (config.inferenceRules ?? []).map((rule) => ({
    ...rule,
    values: valuesManager.getForRule(rule.name),
  }));

  return {
    description: (config as Record<string, unknown>)['description'] ?? '',
    search: config.search ?? {},
    schemas: [],
    inferenceRules,
    mapHelpers: {
      ...config.mapHelpers,
      ...(helperExports?.mapHelpers
        ? { _exports: helperExports.mapHelpers }
        : {}),
    },
    templateHelpers: {
      ...config.templateHelpers,
      ...(helperExports?.templateHelpers
        ? { _exports: helperExports.templateHelpers }
        : {}),
    },
    maps: config.maps ?? {},
    templates: config.templates ?? {},
    slots: config.slots ?? {},
    issues: issuesManager.getAll(),
  };
}

/**
 * Resolve file references in a document. Reads JSON files at paths found in string values.
 *
 * @param doc - The document to resolve.
 * @param resolveTypes - Which resolution types to apply.
 * @returns The resolved document.
 */
export function resolveReferences(
  doc: Record<string, unknown>,
  resolveTypes: ('files' | 'globals')[],
): Record<string, unknown> {
  if (!resolveTypes.includes('files')) return doc;

  return JSON.parse(
    JSON.stringify(doc, (_key, value: unknown) => {
      if (
        typeof value === 'string' &&
        (value.endsWith('.json') || value.endsWith('.js'))
      ) {
        try {
          const content = readFileSync(value, 'utf-8');
          if (value.endsWith('.json')) {
            return JSON.parse(content) as unknown;
          }
          return content;
        } catch {
          return value;
        }
      }
      return value;
    }),
  ) as Record<string, unknown>;
}
