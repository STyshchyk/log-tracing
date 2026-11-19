import type { Pool } from 'pg';

/**
 * Single glossary entry returned by glossary search and lookup queries.
 */
export interface GlossaryEntry {
  error_code: string;
  title: string;
  symptoms: string;
  fix_steps_md: string;
  updated_at: string;
  is_active: boolean;
}

/**
 * Result returned by querying the error glossary, optionally in the context of a machine.
 */
export interface GlossaryQueryResult {
  active_error: string | null;
  entries: GlossaryEntry[];
}

/**
 * Optional filter and machine-pinning parameters for glossary queries.
 */
export interface QueryGlossaryOptions {
  q?: string | undefined;
  machineId?: string | undefined;
}

interface GlossaryRow {
  error_code: string;
  title: string;
  symptoms: string;
  fix_steps_md: string;
  updated_at: Date;
  is_active: boolean;
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/**
 * Query error_glossary entries with optional case-insensitive search filtering
 * and optional machine active_error pinning. Returns null when machineId is unknown.
 */
export async function queryGlossary(
  db: Pool,
  options: QueryGlossaryOptions = {},
): Promise<GlossaryQueryResult | null> {
  const machineId = options.machineId?.trim();
  let activeError: string | null = null;

  if (machineId) {
    const machineResult = await db.query<{ active_error: string | null }>(
      'SELECT active_error FROM machines WHERE id = $1',
      [machineId],
    );
    const machine = machineResult.rows[0];
    if (!machine) {
      return null;
    }
    activeError = machine.active_error;
  }

  const trimmedQuery = options.q?.trim();
  const params: unknown[] = [activeError];
  let whereClause = '';

  if (trimmedQuery) {
    params.push(`%${escapeLikePattern(trimmedQuery)}%`);
    whereClause =
      "WHERE (error_code ILIKE $2 ESCAPE '\\' OR title ILIKE $2 ESCAPE '\\' OR symptoms ILIKE $2 ESCAPE '\\' OR fix_steps_md ILIKE $2 ESCAPE '\\')";
  }

  const result = await db.query<GlossaryRow>(
    `SELECT
       error_code,
       title,
       symptoms,
       fix_steps_md,
       updated_at,
       ($1::text IS NOT NULL AND error_code = $1::text) AS is_active
     FROM error_glossary
     ${whereClause}
     ORDER BY
       CASE WHEN $1::text IS NOT NULL AND error_code = $1::text THEN 0 ELSE 1 END ASC,
       error_code ASC`,
    params,
  );

  return {
    active_error: activeError,
    entries: result.rows.map((row) => ({
      error_code: row.error_code,
      title: row.title,
      symptoms: row.symptoms,
      fix_steps_md: row.fix_steps_md,
      updated_at: row.updated_at.toISOString(),
      is_active: row.is_active,
    })),
  };
}
