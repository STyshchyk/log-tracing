import type { Pool } from 'pg';
import { loadFaultRegistry, type FaultEntry } from '../spec/fault-registry.js';

/**
 * Idempotently seed or update error_glossary rows from the shared fault registry.
 * Sorts entries by error_code before upserting so concurrent callers acquire locks in a consistent order.
 */
export async function seedGlossary(
  db: Pool,
  entries: readonly FaultEntry[] = loadFaultRegistry(),
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const sorted = [...entries].sort((a, b) =>
    a.error_code < b.error_code ? -1 : a.error_code > b.error_code ? 1 : 0,
  );

  const errorCodes = sorted.map((entry) => entry.error_code);
  const titles = sorted.map((entry) => entry.title);
  const symptoms = sorted.map((entry) => entry.symptoms);
  const fixSteps = sorted.map((entry) => entry.fix_steps_md);

  await db.query(
    `INSERT INTO error_glossary (error_code, title, symptoms, fix_steps_md)
     SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[])
     ON CONFLICT (error_code) DO UPDATE
     SET
       title = EXCLUDED.title,
       symptoms = EXCLUDED.symptoms,
       fix_steps_md = EXCLUDED.fix_steps_md,
       updated_at = NOW()
     WHERE
       error_glossary.title IS DISTINCT FROM EXCLUDED.title
       OR error_glossary.symptoms IS DISTINCT FROM EXCLUDED.symptoms
       OR error_glossary.fix_steps_md IS DISTINCT FROM EXCLUDED.fix_steps_md`,
    [errorCodes, titles, symptoms, fixSteps],
  );
}
