/**
 * @module plugin/lazyCore
 * Lazy `configRoot` resolution and deferred jeeves-core initialization.
 *
 * @remarks
 * Registration must always succeed, even with no plugin config (#235). The
 * config root is resolved on first tool use; core `init()` runs once, only
 * after it resolves. Tools invoked before then return a clear error.
 */

import {
  fail,
  init,
  type PluginApi,
  resolveWorkspacePath,
  type ToolDescriptor,
  type ToolRegistrationOptions,
} from '@karmaniverous/jeeves';

import {
  CONFIG_ROOT_NOT_CONFIGURED,
  CONFIG_ROOT_UNSET_WARNING,
} from './constants.js';
import { getConfigRoot } from './helpers.js';

/** Resolves `configRoot` and initializes core on first success. */
export type EnsureCore = () => string | undefined;

/**
 * Create a lazy core initializer bound to a plugin API instance.
 *
 * @returns A function that resolves `configRoot` (initializing core once)
 * or returns `undefined` while it is unset.
 */
export function createLazyCore(api: PluginApi): EnsureCore {
  let initializedWith: string | undefined;

  return () => {
    const configRoot = getConfigRoot(api);
    if (configRoot === undefined) return undefined;

    if (initializedWith !== configRoot) {
      init({ workspacePath: resolveWorkspacePath(api), configRoot });
      initializedWith = configRoot;
    }

    return configRoot;
  };
}

/**
 * Log the "configRoot not configured" warning if it is currently unset.
 *
 * @returns `true` when the warning was logged.
 */
export function warnIfConfigRootUnset(api: PluginApi): boolean {
  if (getConfigRoot(api) !== undefined) return false;

  if (api.logger) api.logger.warn(CONFIG_ROOT_UNSET_WARNING);
  else console.warn(CONFIG_ROOT_UNSET_WARNING);

  return true;
}

/** Wrap a tool so it resolves core before executing. */
export function guardTool(
  tool: ToolDescriptor,
  ensureCore: EnsureCore,
): ToolDescriptor {
  return {
    ...tool,
    execute: async (id, params) => {
      try {
        if (ensureCore() === undefined) return fail(CONFIG_ROOT_NOT_CONFIGURED);
      } catch (error) {
        return fail(error);
      }

      return tool.execute(id, params);
    },
  };
}

/**
 * Derive a plugin API whose `registerTool` guards every tool with
 * {@link guardTool}. All other members delegate to the original API.
 */
export function withGuardedTools(
  api: PluginApi,
  ensureCore: EnsureCore,
): PluginApi {
  return {
    ...api,
    registerTool: (tool: ToolDescriptor, options?: ToolRegistrationOptions) => {
      api.registerTool(guardTool(tool, ensureCore), options);
    },
  };
}
