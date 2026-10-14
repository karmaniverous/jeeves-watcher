/**
 * @module plugin/toolGating
 * Which watcher tool invocations read `configRoot`, and so must be gated on it.
 *
 * @remarks
 * Uniform Jeeves rule: a tool refuses with the "configRoot not configured"
 * error only when its implementation actually reads `configRoot`. Tools
 * that only call the service HTTP API keep working without it.
 *
 * Audit of the tools the plugin registers:
 * - `watcher_status` (core standard toolset, `createPluginToolset`): HTTP
 *   only (`{apiUrl}/status`, resolved per call).
 * - `watcher_config`, `watcher_config_apply`: implemented by the plugin
 *   (`configTools.ts`, replacing the core ones so the request carries the
 *   `Authorization: Bearer` key); HTTP only.
 * - `watcher_service` (core standard toolset): only `install` reads
 *   `configRoot` (`createServiceManager` → `resolveConfigFilePath` →
 *   `getComponentConfigDir`); the other actions query or drive the OS
 *   service manager by service name.
 *
 * The 14 domain tools (7 in `watcherTools.ts`, 7 VCS tools in
 * `vcsTools.ts`) call the service API via `registerApiTool` →
 * `requestJson` and are never gated.
 */

/** Decides, per call, whether a tool invocation reads `configRoot`. */
export type ConfigRootPredicate = (
  params: Record<string, unknown> | undefined,
) => boolean;

/**
 * Tools whose implementation reads `configRoot`, keyed by tool name. A tool
 * absent from this map is HTTP only and is never gated.
 */
export const CONFIG_ROOT_READERS: Readonly<
  Partial<Record<string, ConfigRootPredicate>>
> = {
  watcher_service: (params) => params?.action === 'install',
};
