import path from "node:path";
import fs from "node:fs";
import { supabase, batchInsert } from "./supabase.js";
import { fetchAllPeople } from "./fub.js";
import {
  buildSponsors,
  loadSponsorsCsv,
  type PreparedSponsor,
} from "./import-sponsors.js";
import {
  buildDeals,
  dealForInsert,
  loadDealsCsv,
  type PreparedDeal,
} from "./import-deals.js";
import { printResults, runValidation } from "./validate.js";

const SEED_USERS = [
  { fub_user_id: 1, full_name: "Brandon Brooks", email: "brandon@lennoxlending.com", role: "owner" },
  { fub_user_id: 2, full_name: "Tammy Bains", email: "Tammy@lennoxlending.com", role: "admin" },
  { fub_user_id: 3, full_name: "Cameron Brooks", email: "Cameron@lennoxlending.com", role: "admin" },
  { fub_user_id: 4, full_name: "Austin Gray", email: "Austin@lennoxlending.com", role: "rep" },
  { fub_user_id: 5, full_name: "Nick Brooks", email: "Nick.b@lennoxlending.com", role: "rep" },
  { fub_user_id: 6, full_name: "Lennox Lending Sales Team", email: "sales@lennoxlending.com", role: "rep" },
  { fub_user_id: 13, full_name: "Nora Gamboa", email: "nlovemarketing@gmail.com", role: "admin" },
  { fub_user_id: 14, full_name: "Michael Heap", email: "data@lennoxlending.com", role: "admin" },
  { fub_user_id: 15, full_name: "Gabe Michel", email: "kappi.site@gmail.com", role: "rep" },
] as const;

const REP_NAME_TO_FUB_USER_ID: Record<string, number> = {
  "Austin Gray": 4,
  "Nick Brooks": 5,
  "Cameron Brooks": 3,
  "Brandon Brooks": 1,
  "Tammy Bains": 2,
  "Nora Gamboa": 13,
  "Michael Heap": 14,
  "Gabe Michel": 15,
  "Lennox Lending Sales Team": 6,
};

function fmtPct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

async function ensureSeedUsers(write: boolean): Promise<Map<number, string>> {
  if (write) {
    const rows = SEED_USERS.map((u) => ({
      fub_user_id: u.fub_user_id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      is_active: true,
    }));
    const { error } = await supabase
      .from("app_users")
      .upsert(rows, { onConflict: "email" });
    if (error) throw new Error(`seed app_users: ${error.message}`);
  }

  const fubIds = SEED_USERS.map((u) => u.fub_user_id);
  const { data, error } = await supabase
    .from("app_users")
    .select("id, fub_user_id")
    .in("fub_user_id", fubIds);
  if (error) throw new Error(`fetch app_users: ${error.message}`);

  const map = new Map<number, string>();
  for (const u of data ?? []) {
    const row = u as { id: string; fub_user_id: number };
    map.set(row.fub_user_id, row.id);
  }

  if (!write) {
    let synthetic = 0;
    for (const u of SEED_USERS) {
      if (!map.has(u.fub_user_id)) {
        map.set(u.fub_user_id, `pending-uuid-${u.fub_user_id}`);
        synthetic++;
      }
    }
    if (synthetic > 0) {
      console.error(
        `[dry-run] ${synthetic} seed app_user(s) not yet in DB; using synthetic IDs for preview only`,
      );
    }
  }

  return map;
}

function buildRepNameMap(fubUserIdToUuid: Map<number, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [name, fubId] of Object.entries(REP_NAME_TO_FUB_USER_ID)) {
    const uuid = fubUserIdToUuid.get(fubId);
    if (uuid) m.set(name, uuid);
  }
  return m;
}

function sponsorForInsert(s: PreparedSponsor): Record<string, unknown> {
  return {
    first_name: s.first_name,
    last_name: s.last_name,
    legacy_sheet_name: s.legacy_sheet_name,
    email: s.email,
    phone: s.phone,
    fub_person_id: s.fub_person_id,
    fub_url: s.fub_url,
    fub_stage: s.fub_stage,
    sales_rep_id: s.sales_rep_id,
    lead_source: s.lead_source,
    lead_created_at: s.lead_created_at,
    fub_match_confidence: s.fub_match_confidence,
    needs_dedup_review: s.needs_dedup_review,
    import_notes: s.import_notes,
  };
}

function printSampleSponsors(sponsors: PreparedSponsor[]) {
  console.log("\nSample sponsors (first 5):");
  for (const s of sponsors.slice(0, 5)) {
    console.log(
      `  - ${s.legacy_sheet_name} | match=${s.fub_match_confidence} | fub=${s.fub_person_id ?? "-"} | rep=${s.sales_rep_id ?? "-"} | email=${s.email ?? "-"}`,
    );
  }
}

function printSampleDeals(deals: PreparedDeal[]) {
  console.log("\nSample deals (first 5):");
  for (const d of deals.slice(0, 5)) {
    console.log(
      `  - ${d.sponsor_legacy_name} | ${d.deal_pipeline_stage} | entry=${d.deal_pipeline_entry_date} | loan=${d.loan_amount ?? "-"} | quote=${d.quote_stage ?? "-"}`,
    );
  }
}

async function run(write: boolean) {
  const start = Date.now();
  console.log("=== LENNOX MIGRATION DRY RUN ===");
  console.log(`Mode: ${write ? "WRITE (will commit to Supabase)" : "DRY RUN (no writes)"}`);

  const dataDir = path.resolve(process.cwd(), "data");
  const sponsorsCsv = path.join(dataDir, "sponsors.csv");
  const dealsCsv = path.join(dataDir, "pipeline.csv");

  if (!fs.existsSync(sponsorsCsv)) throw new Error(`Missing ${sponsorsCsv}`);
  if (!fs.existsSync(dealsCsv)) throw new Error(`Missing ${dealsCsv}`);

  console.log("\n[1/5] Loading CSVs...");
  const sponsorRows = loadSponsorsCsv(sponsorsCsv);
  const dealRows = loadDealsCsv(dealsCsv);
  console.log(`  sponsors.csv: ${sponsorRows.length} rows`);
  console.log(`  pipeline.csv: ${dealRows.length} rows`);

  const fubUserMap = await ensureSeedUsers(write);
  const repNameToUuid = buildRepNameMap(fubUserMap);

  console.log("\n[2/5] Fetching FUB Persons...");
  const fubStart = Date.now();
  let lastLogged = 0;
  const people = await fetchAllPeople({
    onProgress: (count) => {
      if (count - lastLogged >= 500) {
        process.stderr.write(`  fetched ${count} so far...\n`);
        lastLogged = count;
      }
    },
  });
  console.log(`  Total: ${people.length.toLocaleString()}`);
  console.log(`  Time: ${Math.round((Date.now() - fubStart) / 1000)}s`);

  console.log("\n[3/5] Matching sponsors to FUB...");
  const sponsorResult = buildSponsors(sponsorRows, people, repNameToUuid);
  const total = sponsorResult.prepared.length;
  console.log(
    `  Exact unique:              ${sponsorResult.matchCounts.exact_unique} (${fmtPct(sponsorResult.matchCounts.exact_unique, total)})`,
  );
  console.log(
    `  Exact ambiguous (resolved):${String(sponsorResult.matchCounts.exact_ambiguous_resolved).padStart(4)} (${fmtPct(sponsorResult.matchCounts.exact_ambiguous_resolved, total)})`,
  );
  console.log(
    `  No match:                  ${String(sponsorResult.matchCounts.none).padStart(4)} (${fmtPct(sponsorResult.matchCounts.none, total)})`,
  );
  if (sponsorResult.dedupNames.length > 0) {
    console.log(
      `\n  Same-name dupes flagged:    ${sponsorResult.dedupNames.length} (${sponsorResult.dedupNames.join(", ")})`,
    );
  }

  console.log("\n[4/5] Normalizing deals...");
  const sponsorNameToId = new Map<string, string>();
  if (write) {
    console.log("  (sponsor IDs will be assigned by Supabase upsert)");
  } else {
    sponsorResult.prepared.forEach((s, i) => {
      sponsorNameToId.set(s.legacy_sheet_name.toLowerCase(), `pending-sponsor-${i}`);
    });
  }
  const dealResult = buildDeals(
    dealRows,
    write ? new Map() : sponsorNameToId,
  );
  console.log(`  Deals: ${dealResult.prepared.length}`);
  console.log(
    `  Quote stages parsed:        ${dealResult.stats.quoteStageParsed} (${dealResult.stats.quoteStageRefCoerced} '#REF!' coerced to null)`,
  );
  const c = dealResult.stats.quoteLostCategories;
  console.log(
    `  Quote lost reasons categorized:\n    Rejected: ${c.Rejected}, Pricing: ${c.Pricing}, Ghosted: ${c.Ghosted}, Other: ${c.Other}, null: ${c.null}`,
  );
  if (dealResult.stats.unknownPipelineStages.size > 0) {
    console.log("  Unknown pipeline stages encountered (defaulted to 'Just Added'):");
    for (const [k, v] of dealResult.stats.unknownPipelineStages) {
      console.log(`    ${k}: ${v}`);
    }
  }
  if (dealResult.stats.rowsMissingEntryDate > 0) {
    console.log(
      `  WARNING: ${dealResult.stats.rowsMissingEntryDate} rows missing/unparseable Deal Pipeline Entry Date (placeholder 1970-01-01 used)`,
    );
  }

  console.log("\n  Sales rep mapping:");
  for (const [rep, count] of sponsorResult.repCounts) {
    if (rep.startsWith("UNKNOWN(")) {
      console.log(`    ${rep}: ${count}  (UNMAPPED)`);
    } else {
      const uuid = repNameToUuid.get(rep) ?? "?";
      console.log(`    ${rep} → user_id=${uuid}: ${count}`);
    }
  }
  if (sponsorResult.unmappedRepCount > 0) {
    console.log(
      `    UNMAPPED: ${sponsorResult.unmappedRepCount} sponsor(s) with empty/unknown Sales Rep`,
    );
  }

  console.log("\n[5/5] Validation preview:");
  console.log(`  Sponsors that would insert:  ${sponsorResult.prepared.length}`);
  console.log(`  Deals that would insert:     ${dealResult.prepared.length}`);
  console.log(`  Orphan deals (no sponsor match): ${dealResult.stats.orphans.length}`);
  if (dealResult.stats.orphans.length > 0) {
    const sample = dealResult.stats.orphans.slice(0, 5).map((o) => o.sponsor_legacy_name);
    console.log(`    Examples: ${sample.join(", ")}`);
  }

  printSampleSponsors(sponsorResult.prepared);
  printSampleDeals(dealResult.prepared);

  if (!write) {
    console.log(`\nElapsed: ${Math.round((Date.now() - start) / 1000)}s`);
    console.log("\nRun with --write to commit.");
    return;
  }

  console.log("\n=== WRITE PHASE ===");

  console.log("\n[a] Upserting sponsors...");
  const sponsorRowsForInsert = sponsorResult.prepared.map(sponsorForInsert);
  const sponsorWrite = await batchInsert("sponsors", sponsorRowsForInsert, {
    onConflict: "legacy_sheet_name",
  });
  console.log(
    `  upserted: ${sponsorWrite.inserted}/${sponsorRowsForInsert.length} (errors: ${sponsorWrite.errors.length})`,
  );

  console.log("\n[b] Loading sponsor name → uuid map from DB...");
  const { data: sponsorIdRows, error: sErr } = await supabase
    .from("sponsors")
    .select("id, legacy_sheet_name");
  if (sErr) throw new Error(`fetch sponsor ids: ${sErr.message}`);
  const idMap = new Map<string, string>();
  for (const r of sponsorIdRows ?? []) {
    const row = r as { id: string; legacy_sheet_name: string | null };
    if (row.legacy_sheet_name) {
      idMap.set(row.legacy_sheet_name.trim().toLowerCase(), row.id);
    }
  }
  console.log(`  resolved ${idMap.size} sponsor IDs`);

  console.log("\n[c] Inserting deals...");
  const dealsWithIds = dealResult.prepared
    .map((d) => ({
      ...d,
      sponsor_id: idMap.get(d.sponsor_legacy_name.toLowerCase()) ?? null,
    }))
    .filter((d) => {
      if (!d.sponsor_id) {
        console.error(`  skipping orphan deal for sponsor "${d.sponsor_legacy_name}"`);
        return false;
      }
      return true;
    });
  const dealRowsForInsert = dealsWithIds.map((d) => dealForInsert(d as PreparedDeal));
  const dealWrite = await batchInsert("deals", dealRowsForInsert);
  console.log(
    `  inserted: ${dealWrite.inserted}/${dealRowsForInsert.length} (errors: ${dealWrite.errors.length})`,
  );

  console.log("\n[d] Running validation...");
  const results = await runValidation();
  const ok = printResults(results);

  console.log(`\nElapsed: ${Math.round((Date.now() - start) / 1000)}s`);

  if (!ok) {
    process.exitCode = 1;
  }
}

const args = new Set(process.argv.slice(2));
const write = args.has("--write");

run(write).catch((err) => {
  console.error(err);
  process.exit(1);
});
