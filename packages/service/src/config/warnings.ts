/**
 * @module config/warnings
 * The non-fatal config warning shape shared by config loading (unknown source keys, reserved rule field names) and `POST /config/validate`. Types only.
 */

/** A non-fatal config validation warning. */
export interface ConfigWarning {
  /** Config location the warning refers to. */
  path: string;
  /** Human-readable warning message. */
  message: string;
}
