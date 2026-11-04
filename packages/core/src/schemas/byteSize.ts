/**
 * @module schemas/byteSize
 * Byte-size settings (Design 10): a number of bytes, or a string with a `k`, `m` or `g` suffix read as binary units (`10m` = 10,485,760 bytes). One schema and one parser for every byte-size key.
 */

import { z } from 'zod';

/** A byte-size string: digits (optionally with a decimal part) and an optional k, m or g suffix. */
const BYTE_SIZE_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*([kmg]?)\s*$/i;

/** Multipliers of the binary-unit suffixes. */
const UNITS: Record<string, number> = {
  '': 1,
  k: 1024,
  m: 1024 ** 2,
  g: 1024 ** 3,
};

/** A byte-size setting: bytes, or a string such as `10m` (binary units). */
export const byteSizeSchema = z.union([
  z.number().int().min(0),
  z
    .string()
    .regex(
      BYTE_SIZE_PATTERN,
      'Expected a byte size: a number, or a number with a k, m or g suffix (binary units)',
    ),
]);

/** A byte-size setting: bytes, or a string such as `10m` (binary units). */
export type ByteSize = z.infer<typeof byteSizeSchema>;

/**
 * Read a byte-size setting as bytes (fractions rounded down).
 *
 * @param value - A number of bytes or a suffixed string.
 * @returns The size in bytes.
 * @throws If the string is not a byte size.
 */
export function parseByteSize(value: ByteSize): number {
  if (typeof value === 'number') return value;
  const match = BYTE_SIZE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid byte size: ${value}`);
  return Math.floor(Number(match[1]) * UNITS[match[2].toLowerCase()]);
}
