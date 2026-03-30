/**
 * @module cli/jeeves-watcher
 *
 * jeeves-watcher CLI entrypoint.
 * Uses core's createServiceCli factory with the watcher descriptor.
 */

import { createServiceCli } from '@karmaniverous/jeeves';

import { watcherDescriptor } from '../../descriptor';

const program = createServiceCli(watcherDescriptor);
program.parse();
