import fs from "node:fs";
import Papa from "papaparse";
import {
  buildNameIndex,
  findCsvDuplicates,
  isDuplicateName,
  matchSponsor,
  type FubMatchKind,
} from "./match.js";
import {
  fubPersonUrl,
  primaryEmail,
  primaryPhone,
  type FubPerson,
} from "./fub.js";
import { parseTimestamp, trimOrNull } from "./normalize.js";

export interface SponsorCsvRow {
  "First Name"?: string;
  "Last Name"?: string;
  "Sponsor name"?: string;
  Email?: string;
  Phone?: string;
  "FUB ID"?: string;
  "FUB URL"?: string;
  "Lead Source"?: string;
  "Lead Created Date"?: string;
  "Sales Rep"?: string;
}

export interface PreparedSponsor {
  first_name: string | null;
  last_name: string | null;
  legacy_sheet_name: string;
  email: string | null;
  phone: string | null;
  fub_person_id: number | null;
  fub_url: string | null;
  fub_stage: string | null;
  lead_source: string | null;
  lead_created_at: string | null;
  sales_rep_id: string | null;
  fub_match_confidence: FubMatchKind;
  needs_dedup_review: boolean;
  import_notes: string | null;
}

export interface SalesRepResolution {
  resolved: Map<string, string>;
  unmappedRows: number;
  byRep: Map<string, number>;
}

export interface SponsorImportResult {
  rows: SponsorCsvRow[];
  prepared: PreparedSponsor[];
  matchCounts: Record<FubMatchKind, number>;
  dedupNames: string[];
  unmappedRepCount: number;
  repCounts: Map<string, number>;
}

export function loadSponsorsCsv(path: string): SponsorCsvRow[] {
  const raw = fs.readFileSync(path, "utf8");
  const parsed = Papa.parse<SponsorCsvRow>(raw, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors.slice(0, 5)) {
      console.error(`sponsors.csv parse warning: ${e.message} (row ${e.row})`);
    }
  }
  return parsed.data.filter((r) => trimOrNull(r["Sponsor name"]) !== null);
}

export function buildSponsors(
  rows: SponsorCsvRow[],
  fubPeople: FubPerson[],
  repNameToUserId: Map<string, string>,
): SponsorImportResult {
  const index = buildNameIndex(fubPeople);
  const sheetNames = rows.map((r) => r["Sponsor name"] ?? "");
  const dupes = findCsvDuplicates(sheetNames);

  const matchCounts: Record<FubMatchKind, number> = {
    exact_unique: 0,
    exact_ambiguous_resolved: 0,
    none: 0,
  };
  const repCounts = new Map<string, number>();
  let unmappedRepCount = 0;

  const prepared: PreparedSponsor[] = rows.map((r) => {
    const sheetName = (r["Sponsor name"] ?? "").trim();
    const csvFirst = trimOrNull(r["First Name"]);
    const csvLast = trimOrNull(r["Last Name"]);
    const csvLeadCreated = parseTimestamp(r["Lead Created Date"]);
    const csvLeadSource = trimOrNull(r["Lead Source"]);

    const match = matchSponsor(sheetName, index);
    if (match.kind === "exact_unique") matchCounts.exact_unique++;
    else if (match.kind === "exact_ambiguous_resolved")
      matchCounts.exact_ambiguous_resolved++;
    else matchCounts.none++;

    const repRaw = trimOrNull(r["Sales Rep"]);
    let salesRepId: string | null = null;
    if (repRaw) {
      const id = repNameToUserId.get(repRaw) ?? null;
      if (id) {
        salesRepId = id;
        repCounts.set(repRaw, (repCounts.get(repRaw) ?? 0) + 1);
      } else {
        unmappedRepCount++;
        repCounts.set(`UNKNOWN(${repRaw})`, (repCounts.get(`UNKNOWN(${repRaw})`) ?? 0) + 1);
      }
    } else {
      unmappedRepCount++;
    }

    let firstName = csvFirst;
    let lastName = csvLast;
    let email: string | null = null;
    let phone: string | null = null;
    let fubPersonId: number | null = null;
    let fubUrl: string | null = trimOrNull(r["FUB URL"]);
    let fubStage: string | null = null;
    let leadCreatedAt: string | null = csvLeadCreated;
    const notes: string[] = [];

    if (match.person) {
      const p = match.person;
      fubPersonId = p.id;
      fubUrl = fubPersonUrl(p.id);
      fubStage = trimOrNull(p.stage);
      email = primaryEmail(p);
      phone = primaryPhone(p);
      if (!firstName && p.firstName) firstName = p.firstName.trim();
      if (!lastName && p.lastName) lastName = p.lastName.trim();
      if (!leadCreatedAt && p.created) {
        leadCreatedAt = parseTimestamp(p.created);
      }
      if (match.note) notes.push(match.note);
    }

    if (isDuplicateName(sheetName, dupes)) {
      notes.push("Duplicate sponsor name in source CSV — flagged for dedup review");
    }

    return {
      first_name: firstName,
      last_name: lastName,
      legacy_sheet_name: sheetName,
      email,
      phone,
      fub_person_id: fubPersonId,
      fub_url: fubUrl,
      fub_stage: fubStage,
      lead_source: csvLeadSource,
      lead_created_at: leadCreatedAt,
      sales_rep_id: salesRepId,
      fub_match_confidence: match.kind,
      needs_dedup_review: isDuplicateName(sheetName, dupes),
      import_notes: notes.length ? notes.join("; ") : null,
    };
  });

  const dedupNames = Array.from(dupes);

  return {
    rows,
    prepared,
    matchCounts,
    dedupNames,
    unmappedRepCount,
    repCounts,
  };
}
