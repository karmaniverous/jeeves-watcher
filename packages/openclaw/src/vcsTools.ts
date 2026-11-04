/**
 * @module plugin/vcsTools
 * Version-tracking (watcher_vcs_*) tools for the OpenClaw plugin: configs mapping tool params to a watcher VCS endpoint, and the place of the catalog-built `watcher_vcs_show`.
 */

import {
  getEndpoint,
  VCS_EXCLUDE_CONFIRM_THRESHOLD,
} from '@karmaniverous/jeeves-watcher-core';

import { buildQuery, pickDefined, type WatcherToolEntry } from './apiTool.js';

/** `watcher_vcs_exclude` description (0.21.0, spec B4). */
export const VCS_EXCLUDE_DESCRIPTION = `Exclude a path from version history (VCS-only: it stays in search), or remove the exclusion. Adding untracks the files the pattern matches, ending their history; more than ${String(VCS_EXCLUDE_CONFIRM_THRESHOLD)} files need confirm: true.`;

/** `watcher_vcs_exclude` `glob` description (0.21.0, spec B4). */
export const VCS_EXCLUDE_GLOB_DESCRIPTION =
  'One gitignore pattern, absolute under a tracked root or relative to root (no leading /: a glob starting with / is a filesystem path); written root-anchored to the root .git/info/exclude. Brackets are a character class: escape them to name a file literally (Report \\[draft\\].docx).';

/** `watcher_vcs_exclude` `confirm` description (0.21.0, spec B4). */
export const VCS_EXCLUDE_CONFIRM_DESCRIPTION = `Required (true) when adding the pattern would untrack more than ${String(VCS_EXCLUDE_CONFIRM_THRESHOLD)} files.`;

/** `watcher_vcs_exclude` `remove` description (0.21.0, spec B4). */
export const VCS_EXCLUDE_REMOVE_DESCRIPTION =
  'When true, remove the exclusion rule. Untracked files are not re-added; their next change is versioned again.';

/** `watcher_vcs_check` description (0.21.0, spec B4). */
export const VCS_CHECK_DESCRIPTION =
  'Check whether git ignores a path and why: the rule, the file holding it and its line';

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
    description: VCS_EXCLUDE_DESCRIPTION,
    parameters: {
      type: 'object',
      required: ['glob'],
      properties: {
        glob: {
          type: 'string',
          description: VCS_EXCLUDE_GLOB_DESCRIPTION,
        },
        root: {
          type: 'string',
          description: 'Tracked root to target (defaults to auto-detect).',
        },
        remove: {
          type: 'boolean',
          description: VCS_EXCLUDE_REMOVE_DESCRIPTION,
        },
        confirm: {
          type: 'boolean',
          description: VCS_EXCLUDE_CONFIRM_DESCRIPTION,
        },
      },
    },
    buildRequest: (params) => {
      const body = pickDefined(params, ['glob', 'root', 'remove', 'confirm']);
      return [getEndpoint('vcsExclude').path, body];
    },
  },
  {
    name: 'watcher_vcs_check',
    description: VCS_CHECK_DESCRIPTION,
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
