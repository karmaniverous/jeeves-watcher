/**
 * @module extractors/frontmatter
 *
 * Front-matter parsing with `yaml` (#203, spec D158): the parsed value matches what js-yaml's `load` gave in 0.20.0, and input js-yaml refused is still refused, so a file's indexed metadata does not change. Accepted differences: a `!!float` tag on a scalar not in float form (`!!float 1`, `!!float "1"`) fails here (D169, D180), as does a `%YAML` directive other than 1.2.
 */

import {
  type Document,
  isAlias,
  isCollection,
  isScalar,
  parseDocument,
  visit,
} from 'yaml';

/** A plain scalar that is a float literal for infinity (`.inf`, `-.Inf`, ...). */
const INFINITY_LITERAL = /^[-+]?\.inf$/i;

/** The YAML version front matter is read as. */
const YAML_VERSION = '1.2';

/**
 * Bring the document's resolved values in line with js-yaml where `yaml`
 * accepts input js-yaml rejects, or resolves it differently.
 *
 * - A collection used as a mapping key (`[a]: x`, `? {a: 1}`, or an alias of
 *   a collection) fails, as in js-yaml ("object-based map does not support
 *   complex keys"); `yaml` would stringify it.
 * - A null key (`~: x`, `null: x`) becomes `"null"`, as in js-yaml; `yaml`
 *   would give `""`.
 * - A number too large for a double (`1e400`) stays the scalar's text, as in
 *   js-yaml; `yaml` would give `Infinity`.
 *
 * @param doc - A parsed document with no errors or warnings.
 * @throws Error on a complex mapping key.
 */
function alignWithJsYaml(doc: Document): void {
  visit(doc, {
    Pair(_, pair) {
      const key = isAlias(pair.key) ? pair.key.resolve(doc) : pair.key;
      if (isCollection(key)) {
        throw new Error(
          'front matter uses a collection as a mapping key, which is not supported',
        );
      }
      if (isScalar(pair.key) && pair.key.value === null)
        pair.key.value = 'null';
    },
    Scalar(_, scalar) {
      const { value, source } = scalar;
      if (
        typeof value === 'number' &&
        !Number.isFinite(value) &&
        !Number.isNaN(value) &&
        typeof source === 'string' &&
        !INFINITY_LITERAL.test(source)
      ) {
        scalar.value = source;
      }
    },
  });
}

/**
 * Parse a front-matter block.
 *
 * Line breaks are normalised to `\n` first: the block of a CRLF file ends
 * with a lone `\r` (the closing fence's `\n` is not part of it), which
 * js-yaml reads as a line break but `yaml` keeps in the last plain scalar
 * (`b: 1\r` would be the string `"1\r"`, not the number 1) or reports as an
 * unexpected token after a quoted or flow value.
 *
 * Then `parseDocument(src, { resolveKnownTags: false, logLevel: 'error' })`
 * (D158): only the YAML 1.2 core tags resolve; any entry in `doc.errors` or
 * `doc.warnings` (syntax errors, duplicate keys, more than one document, a
 * non-core or unknown tag, a core tag that cannot resolve its scalar) throws,
 * which the processor records as an `extraction_error`. `parseDocument`
 * never calls `process.emitWarning`, so nothing reaches stderr.
 *
 * @param src - The YAML between the front-matter fences.
 * @returns The parsed value (any YAML value; the caller keeps only a mapping).
 * @throws Error describing the first problem, when the block cannot be parsed,
 *   declares a YAML version other than 1.2, or is empty (js-yaml 5 rejects an
 *   empty document too).
 */
export function parseFrontmatter(src: string): unknown {
  const doc = parseDocument(src.replace(/\r\n?/g, '\n'), {
    resolveKnownTags: false,
    logLevel: 'error',
  });

  const problem = [...doc.errors, ...doc.warnings].at(0);
  if (problem) {
    throw new Error(
      `front matter is not valid YAML (${problem.code}): ${problem.message}`,
    );
  }
  // A `%YAML 1.1` directive would switch `yaml` to YAML 1.1 (`yes` read as
  // true); js-yaml ignored it. Refuse it rather than change a value.
  const { version } = doc.directives.yaml;
  if (version !== YAML_VERSION) {
    throw new Error(
      `front matter declares %YAML ${version}; only YAML ${YAML_VERSION} is supported`,
    );
  }
  if (doc.contents === null) {
    throw new Error('front matter is empty');
  }

  alignWithJsYaml(doc);
  return doc.toJS();
}
