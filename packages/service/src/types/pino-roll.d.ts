/**
 * Type declarations for pino-roll 4.0.0, which ships none. Only the
 * options and stream members the logger uses are declared.
 */
declare module 'pino-roll' {
  import type { EventEmitter } from 'node:events';

  /** The SonicBoom stream pino-roll returns (members the logger uses). */
  export interface RollStream extends EventEmitter {
    /** File descriptor; negative (or absent from its types) until open. */
    fd?: number;
    /** Write a log line. */
    write(data: string): boolean;
    /** Flush buffered lines synchronously (throws if not open). */
    flushSync(): void;
  }

  /** pino-roll options (plus SonicBoom's `mkdir`). */
  export interface PinoRollOptions {
    /** Base log file path; numbers and dates are inserted before the extension. */
    file: string;
    /** Rotate at this size: a number is megabytes; `<n>b|k|m|g` strings. */
    size?: string | number;
    /** `daily`, `hourly`, or milliseconds. */
    frequency?: 'daily' | 'hourly' | number;
    /** date-fns format inserted in file names. */
    dateFormat?: string;
    /** Pruning of old files. */
    limit?: {
      /** Rotated files kept besides the current one. */
      count?: number;
      /** Also prune matching files from earlier runs. */
      removeOtherLogFiles?: boolean;
    };
    /** Maintain a `current.log` symlink. */
    symlink?: boolean;
    /** Create the folder if missing (SonicBoom). */
    mkdir?: boolean;
  }

  /** Build a rotating file stream. */
  export default function pinoRoll(
    options: PinoRollOptions,
  ): Promise<RollStream>;
}
