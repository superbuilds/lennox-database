import { supabase } from "./supabase.js";

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const EXPECTED_SPONSORS = 301;
const EXPECTED_DEALS = 358;
const EXPECTED_FUB_MATCHES_MIN = 260;
const EXPECTED_STAGE_DISTRIBUTION: Record<string, number> = {
  "Quote Sent": 179,
  "New Deal": 72,
  "Deal Lost": 56,
  "Just Added": 20,
  "Needs More Info": 16,
  "Pre-Approval": 13,
  "Long Term Follow Up": 2,
};

export async function runValidation(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const { count: sponsorCount, error: sErr } = await supabase
    .from("sponsors")
    .select("*", { count: "exact", head: true });
  if (sErr) throw new Error(`sponsors count: ${sErr.message}`);
  results.push({
    name: "Sponsor row count",
    pass: sponsorCount === EXPECTED_SPONSORS,
    detail: `got ${sponsorCount} / expected ${EXPECTED_SPONSORS}`,
  });

  const { count: dealCount, error: dErr } = await supabase
    .from("deals")
    .select("*", { count: "exact", head: true });
  if (dErr) throw new Error(`deals count: ${dErr.message}`);
  results.push({
    name: "Deal row count",
    pass: dealCount === EXPECTED_DEALS,
    detail: `got ${dealCount} / expected ${EXPECTED_DEALS}`,
  });

  const { count: matchedCount, error: mErr } = await supabase
    .from("sponsors")
    .select("*", { count: "exact", head: true })
    .not("fub_person_id", "is", null);
  if (mErr) throw new Error(`fub match count: ${mErr.message}`);
  results.push({
    name: "Sponsors with FUB match",
    pass: (matchedCount ?? 0) >= EXPECTED_FUB_MATCHES_MIN,
    detail: `got ${matchedCount} (expected ~268, min ${EXPECTED_FUB_MATCHES_MIN})`,
  });

  const { count: orphanCount, error: oErr } = await supabase
    .from("deals")
    .select("*", { count: "exact", head: true })
    .is("sponsor_id", null);
  if (oErr) throw new Error(`orphan deals: ${oErr.message}`);
  results.push({
    name: "No deals without sponsor_id",
    pass: orphanCount === 0,
    detail: `${orphanCount} orphan deal(s)`,
  });

  const { data: stageRows, error: stErr } = await supabase
    .from("deals")
    .select("deal_pipeline_stage");
  if (stErr) throw new Error(`stage distribution: ${stErr.message}`);
  const observed = new Map<string, number>();
  for (const r of stageRows ?? []) {
    const k = (r as { deal_pipeline_stage: string }).deal_pipeline_stage;
    observed.set(k, (observed.get(k) ?? 0) + 1);
  }
  const stageMismatches: string[] = [];
  for (const [stage, expected] of Object.entries(EXPECTED_STAGE_DISTRIBUTION)) {
    const got = observed.get(stage) ?? 0;
    if (got !== expected) stageMismatches.push(`${stage}: got ${got}, expected ${expected}`);
  }
  results.push({
    name: "Deal stage distribution",
    pass: stageMismatches.length === 0,
    detail:
      stageMismatches.length === 0
        ? "all stages match expected"
        : stageMismatches.join("; "),
  });

  const { data: quotedRows, error: qErr } = await supabase
    .from("deals")
    .select("loan_amount,date_quoted")
    .not("date_quoted", "is", null);
  if (qErr) throw new Error(`quoted total: ${qErr.message}`);
  const totalQuoted = (quotedRows ?? []).reduce(
    (sum, r) => sum + Number((r as { loan_amount: number | null }).loan_amount ?? 0),
    0,
  );
  results.push({
    name: "Total $ quoted (where date_quoted not null)",
    pass: totalQuoted > 0,
    detail: `$${totalQuoted.toLocaleString()} across ${quotedRows?.length ?? 0} deals`,
  });

  const { data: refSponsors, error: rsErr } = await supabase
    .from("sponsors")
    .select("sales_rep_id")
    .not("sales_rep_id", "is", null);
  if (rsErr) throw new Error(`sponsor reps: ${rsErr.message}`);
  const repIds = new Set<string>();
  for (const r of refSponsors ?? []) {
    const id = (r as { sales_rep_id: string | null }).sales_rep_id;
    if (id) repIds.add(id);
  }
  let missingReps = 0;
  if (repIds.size > 0) {
    const { data: existingUsers, error: uErr } = await supabase
      .from("app_users")
      .select("id")
      .in("id", Array.from(repIds));
    if (uErr) throw new Error(`app_users lookup: ${uErr.message}`);
    const existing = new Set(
      (existingUsers ?? []).map((u) => (u as { id: string }).id),
    );
    for (const id of repIds) if (!existing.has(id)) missingReps++;
  }
  results.push({
    name: "All sponsor sales_rep_id resolve to app_users",
    pass: missingReps === 0,
    detail:
      missingReps === 0
        ? `all ${repIds.size} referenced reps exist`
        : `${missingReps} unresolved rep id(s)`,
  });

  return results;
}

export function printResults(results: CheckResult[]): boolean {
  let allPass = true;
  console.log("\n=== VALIDATION ===");
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`  [${status}] ${r.name}: ${r.detail}`);
    if (!r.pass) allPass = false;
  }
  console.log(`\n${allPass ? "All checks passed." : "One or more checks FAILED."}`);
  return allPass;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runValidation()
    .then((res) => {
      const ok = printResults(res);
      process.exit(ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
