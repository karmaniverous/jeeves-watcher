/**
 * @module cli/jeeves-watcher/vcsCommands
 * The `vcs` command group (#213): status, history, show, diff, revert, check and exclude, each one SDK call (`getVcsStatus`, `listVcsHistory`, `showVcsFile`, `diffVcs`, `revertVcs`, `checkVcsExclusion`, `excludeVcsPath`). JSON replies print as pretty JSON; `show` and `diff` print the raw text.
 */

import type { Command } from '@commander-js/extra-typings';
import { VCS_EXCLUDE_CONFIRM_THRESHOLD } from '@karmaniverous/jeeves-watcher-core';

import {
  printJson,
  printText,
  runApiCommand,
  withApiOptions,
} from './apiOptions';

/** How to check whether a timed-out exclusion completed (D119). */
const CHECK_EXCLUDE = '`jeeves-watcher vcs check <path>` or `vcs status`';

/** How to check whether a timed-out revert completed (D119). */
const CHECK_REVERT = '`jeeves-watcher vcs history <glob>`';

/**
 * Register the `vcs` command group.
 *
 * @param program - The Commander program.
 */
export function registerVcsCommands(program: Command): void {
  const vcs = program
    .command('vcs')
    .description('Version history of the watched files (/vcs/*)');

  withApiOptions(
    vcs
      .command('status')
      .description('VCS state of every root (GET /vcs/status)'),
  ).action((opts) =>
    runApiCommand(opts, async (client) => {
      printJson(await client.getVcsStatus());
    }),
  );

  withApiOptions(
    vcs
      .command('history')
      .description('Change history of a path or glob (GET /vcs/history)')
      .argument('<glob>', 'Path or glob inside a VCS root')
      .option('--since <date>', 'Only commits after this date')
      .option('--until <date>', 'Only commits before this date')
      .option('--limit <n>', 'Most commits to return (server default 20)'),
  ).action((glob, opts) =>
    runApiCommand(opts, async (client) => {
      printJson(
        await client.listVcsHistory({
          glob,
          since: opts.since,
          until: opts.until,
          limit: opts.limit,
        }),
      );
    }),
  );

  withApiOptions(
    vcs
      .command('show')
      .description('File content at a commit (GET /vcs/show)')
      .argument('<path>', 'File path inside a VCS root')
      .argument('<commit>', 'Commit to read the file from'),
  ).action((path, commit, opts) =>
    runApiCommand(opts, async (client) => {
      printText(await client.showVcsFile({ path, commit }));
    }),
  );

  withApiOptions(
    vcs
      .command('diff')
      .description('Unified diff from a commit (GET /vcs/diff)')
      .argument('<glob>', 'Path or glob inside a VCS root')
      .argument('<commit>', 'Commit to diff from')
      .option('--to <commit>', 'Commit to diff to (default: the working tree)'),
  ).action((glob, commit, opts) =>
    runApiCommand(opts, async (client) => {
      printText(await client.diffVcs({ glob, commit, commitEnd: opts.to }));
    }),
  );

  withApiOptions(
    vcs
      .command('revert')
      .description(
        'Restore files from a commit, as a new commit (POST /vcs/revert)',
      )
      .argument('<glob>', 'Path or glob inside a VCS root')
      .argument('<commit>', 'Commit to restore from')
      .option('--existing-only', 'Restore only files that exist now'),
  ).action((glob, commit, opts) =>
    runApiCommand(
      opts,
      async (client) => {
        printJson(
          await client.revertVcs({
            glob,
            commit,
            ...(opts.existingOnly ? { existingOnly: true } : {}),
          }),
        );
      },
      CHECK_REVERT,
    ),
  );

  withApiOptions(
    vcs
      .command('check')
      .description(
        'Whether git ignores a path, and the rule, file and line (GET /vcs/check-exclusion)',
      )
      .argument('<path>', 'Path inside a VCS root'),
  ).action((path, opts) =>
    runApiCommand(opts, async (client) => {
      printJson(await client.checkVcsExclusion({ path }));
    }),
  );

  withApiOptions(
    vcs
      .command('exclude')
      .description(
        'Exclude a gitignore pattern from version history (it stays in search) and untrack the files it matches, or remove the exclusion (POST /vcs/exclude)',
      )
      .argument(
        '<glob>',
        'One gitignore pattern (escape brackets to name a file: Report \\[draft\\].docx)',
      )
      .option('--remove', 'Remove the exclusion instead of adding it')
      .option('--root <root>', 'VCS root the glob is relative to')
      .option(
        '--confirm',
        `Allow untracking more than ${String(VCS_EXCLUDE_CONFIRM_THRESHOLD)} files`,
      ),
  ).action((glob, opts) =>
    runApiCommand(
      opts,
      async (client) => {
        const result = await client.excludeVcsPath({
          glob,
          root: opts.root,
          ...(opts.remove ? { remove: true } : {}),
          ...(opts.confirm ? { confirm: true } : {}),
        });
        if ('confirmRequired' in result) {
          // Nothing was excluded: not a success for a script (D204 (5)).
          console.error(
            `Not excluded: ${String(result.untracked)} files would be untracked. Repeat with --confirm.`,
          );
          process.exitCode = 1;
          return;
        }
        printJson(result);
      },
      CHECK_EXCLUDE,
    ),
  );
}
