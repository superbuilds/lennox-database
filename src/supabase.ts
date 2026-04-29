import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

export async function batchInsert<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  opts: { onConflict?: string; batchSize?: number } = {},
): Promise<{ inserted: number; errors: Array<{ batch: number; error: string }> }> {
  const batchSize = opts.batchSize ?? 100;
  const errors: Array<{ batch: number; error: string }> = [];
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    let query = supabase.from(table);
    const { error } = opts.onConflict
      ? await query.upsert(batch, { onConflict: opts.onConflict })
      : await query.insert(batch);

    if (error) {
      console.error(
        `[batch ${batchNum}] insert into ${table} failed: ${error.message}`,
      );
      errors.push({ batch: batchNum, error: error.message });
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, errors };
}
