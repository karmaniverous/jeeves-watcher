/**
 * @module plugin/toolGating
 * Which watcher tool invocations read `configRoot`, and so must be gated on it.
 *
 * @remarks
 * Uniform Jeeves rule: a tool refuses with the "configRoot not configured"
 * error only when its implementation actually reads `configRoot`. Tools
 * that only call the service HTTP API keep working without it.
 *
 * Audit of the core standard toolset (`createPluginToolset`, core 0.6.0-6):
 * - `watcher_status`, `watcher_config`, `watcher_config_apply`: HTTP only
 *   (`{apiUrl}/…`, resolved per call).
 * - `watcher_service`: only `install` reads `configRoot`
 *   (`createServiceManager` → `resolveConfigFilePath` →
 *   `getComponentConfigDir`); the other actions query or drive the OS
 *   service manager by service name.
 *
 * The 14 domain tools call `{apiUrl}/…` via `fetchJson`/`postJson` and are
 * never gated.
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
