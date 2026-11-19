import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const nonEmptyText = z
  .string()
  .refine((value) => value.trim().length > 0, 'String must not be empty or whitespace-only');

const faultEntrySchema = z.strictObject({
  error_code: z
    .string()
    .regex(
      /^[A-Z](?:[A-Z0-9]|_[A-Z0-9])*$/,
      'error_code must be a valid uppercase C++ enum identifier without consecutive or trailing underscores',
    ),
  title: nonEmptyText,
  symptoms: nonEmptyText,
  fix_steps_md: nonEmptyText,
});

/**
 * Single fault definition shared between C++ firmware enums and the backend Glossary.
 */
export type FaultEntry = z.infer<typeof faultEntrySchema>;

const faultRegistrySchema = z.array(faultEntrySchema).min(1);

/**
 * Validate and parse raw fault-registry JSON data into typed entries.
 */
export function parseFaultRegistry(input: unknown): FaultEntry[] {
  const entries = faultRegistrySchema.parse(input);
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.error_code)) {
      throw new Error(`Duplicate error_code in fault registry: ${entry.error_code}`);
    }
    seen.add(entry.error_code);
  }

  return entries;
}

function defaultFaultRegistryPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, '../../spec/error_codes.json'),
    resolve(moduleDir, '../../../spec/error_codes.json'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/**
 * Read and validate the shared fault-code registry JSON file from disk.
 */
export function loadFaultRegistry(): FaultEntry[] {
  const rawJson = readFileSync(defaultFaultRegistryPath(), 'utf8');
  return parseFaultRegistry(JSON.parse(rawJson));
}
