/**
 * @module plugin/promptContext
 * Injects the descriptor's always-in-context rules (`promptRules`, from watcher-core) via `before_prompt_build`.
 *
 * @remarks
 * Replaces the v0.x TOOLS.md `## Watcher` section that core's
 * `ComponentWriter` wrote on a timer. Core registers nothing itself: the
 * plugin passes the descriptor's `promptRules` to `registerPromptContext`.
 */

import {
  type JeevesComponentDescriptor,
  type PluginApi,
  registerPromptContext,
} from '@karmaniverous/jeeves';

/**
 * Register the component's prompt rules with OpenClaw's `before_prompt_build` hook.
 *
 * @param api - Plugin API.
 * @param component - Descriptor carrying `promptRules`.
 * @returns `true` when the hook was registered; `false` when the host has no
 * `api.on` or the descriptor has no rules.
 */
export function registerWatcherPromptContext(
  api: PluginApi,
  component: Pick<JeevesComponentDescriptor, 'promptRules'>,
): boolean {
  if (!component.promptRules) return false;
  return registerPromptContext(api, { content: component.promptRules });
}
