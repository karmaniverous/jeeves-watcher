/**
 * @module cli/jeeves-watcher
 *
 * jeeves-watcher CLI entrypoint.
 * Uses core's createServiceCli factory with the watcher descriptor.
 */

// First: libuv reads UV_THREADPOOL_SIZE when its threadpool starts (D170).
import './threadpool';

import { createServiceCli } from '@karmaniverous/jeeves';

import { watcherDescriptor } from '../../descriptor';

const program = createServiceCli(watcherDescriptor);
program.parse();
