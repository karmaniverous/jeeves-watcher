/**
 * @module sources/sourceUrl
 * Pure helpers: parse `<name>://<id>` references, encode ids segment-by-segment, and build callback URLs from a configured template. No I/O.
 */

import {
  SOURCE_ID_PLACEHOLDER,
  sourceReferenceSchema,
} from '@karmaniverous/jeeves-watcher-core';

import { type ParsedSourceReference, SourceReferenceError } from './types';

/** Separator between source name and id in a reference. */
const REFERENCE_SEPARATOR = '://';

/** Protocols a callback URL may use. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parse a source reference.
 *
 * @param reference - A `<name>://<id>` string.
 * @returns The parsed reference.
 * @throws {@link SourceReferenceError} `invalid_reference` when the string
 *   does not match the core reference schema.
 */
export function parseSourceReference(reference: string): ParsedSourceReference {
  if (!sourceReferenceSchema.safeParse(reference).success) {
    throw new SourceReferenceError(
      'invalid_reference',
      'Source reference must match <name>://<id>',
    );
  }
  const at = reference.indexOf(REFERENCE_SEPARATOR);
  return {
    ref: reference,
    name: reference.slice(0, at),
    id: reference.slice(at + REFERENCE_SEPARATOR.length),
  };
}

/**
 * Encode a document id for substitution into a URL template: each
 * `/`-separated segment is `encodeURIComponent`-encoded and slashes are kept.
 *
 * @param id - The opaque document id.
 * @returns The encoded id.
 * @throws {@link SourceReferenceError} `invalid_id` when a segment is empty
 *   (leading, trailing or doubled `/`) or is `.` / `..`, either of which
 *   would let the id move outside the templated path.
 */
export function encodeSourceId(id: string): string {
  const segments = id.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new SourceReferenceError(
        'invalid_id',
        'Source id must not contain empty, "." or ".." segments',
      );
    }
  }
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

/**
 * Origin of a URL template, or `undefined` when the template is not an
 * absolute http(s) URL or `{id}` sits in its authority (so the origin would
 * depend on the id).
 *
 * @param template - A `sources.<name>.url` template.
 * @returns The fixed origin, or `undefined` when the template is unusable.
 */
export function templateOrigin(template: string): string | undefined {
  const origins = ['a', 'b'].map((sentinel) => {
    try {
      const url = new URL(template.replaceAll(SOURCE_ID_PLACEHOLDER, sentinel));
      return ALLOWED_PROTOCOLS.has(url.protocol) ? url.origin : undefined;
    } catch {
      return undefined;
    }
  });
  return origins[0] !== undefined && origins[0] === origins[1]
    ? origins[0]
    : undefined;
}

/**
 * Build a callback URL from a configured template and a document id.
 *
 * @param template - The `sources.<name>.url` template (contains `{id}`).
 * @param origin - The template's fixed origin (see {@link templateOrigin}).
 * @param id - The opaque document id.
 * @returns The URL to request.
 * @throws {@link SourceReferenceError} `invalid_id` when the id has an
 *   invalid segment or the built URL would leave the configured origin.
 */
export function buildSourceUrl(
  template: string,
  origin: string,
  id: string,
): string {
  const url = template.replaceAll(SOURCE_ID_PLACEHOLDER, encodeSourceId(id));
  // Defensive: encoding already prevents this; never request another origin.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SourceReferenceError(
      'invalid_id',
      'Source id yields an invalid URL',
    );
  }
  if (parsed.origin !== origin) {
    throw new SourceReferenceError(
      'invalid_id',
      'Source id would leave the configured origin',
    );
  }
  return url;
}
