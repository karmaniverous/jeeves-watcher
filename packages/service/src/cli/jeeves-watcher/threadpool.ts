/**
 * @module cli/jeeves-watcher/threadpool
 * Side effect only: sets `UV_THREADPOOL_SIZE` (D170) before anything else in the CLI loads. Imported first by the entry point.
 */

import { ensureThreadpoolSize } from '../../util/threadpool';

ensureThreadpoolSize(process.env);
