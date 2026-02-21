#!/usr/bin/env tsx

/**
 * Generate JSON Schema from Zod schema for IDE autocomplete support.
 * Run with: npx tsx src/config/generate-schema.ts
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toJSONSchema } from 'zod';

import { jeevesWatcherConfigSchema } from './schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schema = toJSONSchema(jeevesWatcherConfigSchema, {
  target: 'draft-07',
  io: 'input',
  unrepresentable: 'any',
  cycles: 'ref',
  reused: 'ref',
});

const schemaPath = join(__dirname, '../../config.schema.json');

writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + '\n', 'utf8');

console.log(`Generated: ${schemaPath}`);
