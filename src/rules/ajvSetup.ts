/**
 * @module rules/ajvSetup
 * AJV instance factory with custom glob keyword for picomatch-based pattern matching in rule schemas.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import picomatch from 'picomatch';

/**
 * Create an AJV instance with a custom `glob` format for picomatch glob matching.
 *
 * @returns The configured AJV instance.
 */
export function createRuleAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({
    keyword: 'glob',
    type: 'string',
    schemaType: 'string',
    validate: (pattern: string, data: string) =>
      picomatch.isMatch(data, pattern),
  });
  return ajv;
}
