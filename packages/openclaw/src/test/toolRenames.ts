/**
 * @module test/toolRenames
 * The plugin tool renames of 0.18.0 (D77, Design 14): each 0.17.0 tool name and its current name, for the surface tests. Pure data.
 */

/** Each renamed 0.17.0 tool name and its current name. */
export const TOOL_RENAMES: Readonly<Record<string, string>> = {
  watcher_enrich: 'watcher_set_metadata',
  watcher_validate: 'watcher_validate_config',
  watcher_issues: 'watcher_list_issues',
  watcher_vcs_status: 'watcher_get_vcs_status',
  watcher_vcs_history: 'watcher_list_vcs_history',
  watcher_vcs_show: 'watcher_show_vcs_file',
  watcher_vcs_diff: 'watcher_diff_vcs',
  watcher_vcs_revert: 'watcher_revert_vcs',
  watcher_vcs_exclude: 'watcher_exclude_vcs_path',
  watcher_vcs_check: 'watcher_check_vcs_exclusion',
};

/**
 * A 0.17.0 tool name under its current name.
 *
 * @param name - The 0.17.0 name.
 * @returns The current name.
 */
export const renamedTool = (name: string): string => TOOL_RENAMES[name] ?? name;
