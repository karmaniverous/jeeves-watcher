/**
 * @module plugin/vcsTools
 * Version-tracking (watcher_vcs_*) tools for the OpenClaw plugin: configs mapping tool params to a watcher VCS endpoint, and the place of the catalog-built `watcher_vcs_show`.
 */

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';

import { buildQuery, pickDefined, type WatcherToolEntry } from './apiTool.js';

/** The 7 watcher_vcs_* tools: configs, and `watcher_vcs_show` built from the catalog. */
export const vcsToolConfigs: WatcherToolEntry[] = [
  {
    name: 'watcher_vcs_status',
    description:
      'Get version tracking health: enabled state, tracked roots, remote status, last activity',
    parameters: { type: 'object', properties: {} },
    buildRequest: () => [getEndpoint('vcsStatus').path],
  },
  {
    name: 'watcher_vcs_history',
    description:
      'Query change history by path or glob with optional date range',
    parameters: {
      type: 'object',
      required: ['glob'],
      properties: {
        glob: {
          type: 'string',
          description: 'Path or glob pattern to query history for.',
        },
        since: {
          type: 'string',
          description: 'Start date (ISO 8601 or git date string).',
        },
        until: {
          type: 'string',
          description: 'End date (ISO 8601 or git date string).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of history entries to return.',
        },
      },
    },
    buildRequest: (params) => [
      `${getEndpoint('vcsHistory').path}${buildQuery(params, ['glob', 'since', 'until', 'limit'])}`,
    ],
  },
  'watcher_vcs_show',
  {
    name: 'watcher_vcs_diff',
    description:
      'Show what changed between two versions, or between a version and current',
    parameters: {
      type: 'object',
      required: ['glob', 'commit'],
      properties: {
        glob: {
          type: 'string',
          description: 'Path or glob pattern to diff.',
        },
        commit: {
          type: 'string',
          description: 'Start version identifier.',
        },
        commitEnd: {
          type: 'string',
          description:
            'End version identifier (defaults to current if omitted).',
        },
      },
    },
    buildRequest: (params) => [
      `${getEndpoint('vcsDiff').path}${buildQuery(params, ['glob', 'commit', 'commitEnd'])}`,
    ],
  },
  {
    name: 'watcher_vcs_revert',
    description: 'Undo changes by restoring files to a specific version',
    parameters: {
      type: 'object',
      required: ['glob', 'commit'],
      properties: {
        glob: {
          type: 'string',
          description: 'Path or glob pattern to revert.',
        },
        commit: {
          type: 'string',
          description: 'Version to restore files to.',
        },
        existingOnly: {
          type: 'boolean',
          description:
            'When true, only revert files that currently exist (skip deleted files).',
        },
      },
    },
    buildRequest: (params) => {
      const body = pickDefined(params, ['glob', 'commit', 'existingOnly']);
      return [getEndpoint('vcsRevert').path, body];
    },
  },
  {
    name: 'watcher_vcs_exclude',
    description: 'Exclude or re-include paths from version tracking',
    parameters: {
      type: 'object',
      required: ['glob'],
      properties: {
        glob: {
          type: 'string',
          description: 'Glob pattern to exclude or re-include.',
        },
        root: {
          type: 'string',
          description: 'Tracked root to target (defaults to auto-detect).',
        },
        remove: {
          type: 'boolean',
          description:
            'When true, remove the exclusion rule (re-include the path).',
        },
      },
    },
    buildRequest: (params) => {
      const body = pickDefined(params, ['glob', 'root', 'remove']);
      return [getEndpoint('vcsExclude').path, body];
    },
  },
  {
    name: 'watcher_vcs_check',
    description:
      'Check whether a path is excluded from version tracking and why',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'File path to check exclusion status for.',
        },
      },
    },
    buildRequest: (params) => [
      `${getEndpoint('vcsCheckExclusion').path}${buildQuery(params, ['path'])}`,
    ],
  },
];
