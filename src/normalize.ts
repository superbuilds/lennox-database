export type DealPipelineStage =
  | "Just Added"
  | "New Deal"
  | "In Review"
  | "Needs More Info"
  | "Waiting on Lender Feedback"
  | "Pre-Approval"
  | "Prelim Approved"
  | "Short Term Follow Up"
  | "Long Term Follow Up"
  | "Quote Sent"
  | "Deal Lost";

export type QuoteStage =
  | "Quote Sent"
  | "Quote Accepted"
  | "Quote Rejected"
  | "Ghosted"
  | "Return to Deal Pipeline";

export type DealLender =
  | "Churchill"
  | "Fidelis"
  | "CV3"
  | "Anchor"
  | "Velocity"
  | "Coastal Equities"
  | "Fund Loans"
  | "Verus"
  | "CoFi"
  | "DIYA"
  | "Other";

export type DealLoanType =
  | "Construction"
  | "Renovation"
  | "DSCR"
  | "Commercial Term"
  | "Bridge"
  | "Mid Construction"
  | "Bridge/DSCR"
  | "GUC";

export type DealPropertyType =
  | "SFR"
  | "Multi-Unit (2-4)"
  | "Multifamily (5+)"
  | "Duplex"
  | "Triplex"
  | "Townhome"
  | "Condo"
  | "Vacant Land"
  | "Subdivision"
  | "Other";

export type DealTransactionType = "Purchase" | "Refinance" | "Delayed Purchase";

export type DealLostReason = "Rejected" | "Disqualified" | "Ghosted";

export type QuoteLostCategory = "Rejected" | "Ghosted" | "Pricing" | "Other";

const PIPELINE_STAGES: ReadonlySet<string> = new Set([
  "Just Added",
  "New Deal",
  "In Review",
  "Needs More Info",
  "Waiting on Lender Feedback",
  "Pre-Approval",
  "Prelim Approved",
  "Short Term Follow Up",
  "Long Term Follow Up",
  "Quote Sent",
  "Deal Lost",
]);

const QUOTE_STAGES: ReadonlySet<string> = new Set([
  "Quote Sent",
  "Quote Accepted",
  "Quote Rejected",
  "Ghosted",
  "Return to Deal Pipeline",
]);

const LENDERS: ReadonlySet<string> = new Set([
  "Churchill",
  "Fidelis",
  "CV3",
  "Anchor",
  "Velocity",
  "Coastal Equities",
  "Fund Loans",
  "Verus",
  "CoFi",
  "DIYA",
  "Other",
]);

const LOAN_TYPES: ReadonlySet<string> = new Set([
  "Construction",
  "Renovation",
  "DSCR",
  "Commercial Term",
  "Bridge",
  "Mid Construction",
  "Bridge/DSCR",
  "GUC",
]);

const PROPERTY_TYPES: ReadonlySet<string> = new Set([
  "SFR",
  "Multi-Unit (2-4)",
  "Multifamily (5+)",
  "Duplex",
  "Triplex",
  "Townhome",
  "Condo",
  "Vacant Land",
  "Subdivision",
  "Other",
]);

const TRANSACTION_TYPES: ReadonlySet<string> = new Set([
  "Purchase",
  "Refinance",
  "Delayed Purchase",
]);

const LOST_REASONS: ReadonlySet<string> = new Set([
  "Rejected",
  "Disqualified",
  "Ghosted",
]);

export interface NormalizationIssue {
  field: string;
  raw: string;
  reason: string;
  rowKey?: string;
}

export function trimOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

export function normalizeEnum<T extends string>(
  value: string | null | undefined,
  allowed: ReadonlySet<string>,
): T | null {
  const t = trimOrNull(value);
  if (!t) return null;
  if (allowed.has(t)) return t as T;
  for (const a of allowed) {
    if (a.toLowerCase() === t.toLowerCase()) return a as T;
  }
  return null;
}

export function normalizePipelineStage(
  v: string | null | undefined,
): DealPipelineStage | null {
  return normalizeEnum<DealPipelineStage>(v, PIPELINE_STAGES);
}

export function normalizeQuoteStage(
  v: string | null | undefined,
): QuoteStage | null {
  const t = trimOrNull(v);
  if (!t) return null;
  if (t === "#REF!") return null;
  return normalizeEnum<QuoteStage>(t, QUOTE_STAGES);
}

export function normalizeLender(
  v: string | null | undefined,
): DealLender | null {
  return normalizeEnum<DealLender>(v, LENDERS);
}

export function normalizeLoanType(
  v: string | null | undefined,
): DealLoanType | null {
  return normalizeEnum<DealLoanType>(v, LOAN_TYPES);
}

export function normalizePropertyType(
  v: string | null | undefined,
): DealPropertyType | null {
  return normalizeEnum<DealPropertyType>(v, PROPERTY_TYPES);
}

export function normalizeTransactionType(
  v: string | null | undefined,
): DealTransactionType | null {
  return normalizeEnum<DealTransactionType>(v, TRANSACTION_TYPES);
}

export function normalizeLostReason(
  v: string | null | undefined,
): DealLostReason | null {
  return normalizeEnum<DealLostReason>(v, LOST_REASONS);
}

export function categorizeQuoteLost(
  raw: string | null | undefined,
): QuoteLostCategory | null {
  const t = trimOrNull(raw);
  if (!t) return null;
  if (t === "Rejected") return "Rejected";
  if (t === "Ghosted") return "Ghosted";
  const lower = t.toLowerCase();
  if (
    lower.includes("pricing") ||
    lower.includes("rate") ||
    lower.includes("leverage")
  ) {
    return "Pricing";
  }
  return "Other";
}

export function parseMoney(v: string | null | undefined): number | null {
  const t = trimOrNull(v);
  if (!t) return null;
  const cleaned = t.replace(/[$,\s]/g, "").replace(/[()]/g, (m) =>
    m === "(" ? "-" : "",
  );
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parsePercent(v: string | null | undefined): number | null {
  const t = trimOrNull(v);
  if (!t) return null;
  const hasPct = t.includes("%");
  const cleaned = t.replace(/[%,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (hasPct) return n / 100;
  if (Math.abs(n) > 1) return n / 100;
  return n;
}

export function parseDate(v: string | null | undefined): string | null {
  const t = trimOrNull(v);
  if (!t) return null;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (mdy) {
    const month = mdy[1]!.padStart(2, "0");
    const day = mdy[2]!.padStart(2, "0");
    let year = mdy[3]!;
    if (year.length === 2) {
      const n = Number(year);
      year = (n >= 70 ? 1900 + n : 2000 + n).toString();
    }
    const iso = `${year}-${month}-${day}`;
    if (!Number.isNaN(new Date(iso).getTime())) return iso;
    return null;
  }
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (ymd) {
    const month = ymd[2]!.padStart(2, "0");
    const day = ymd[3]!.padStart(2, "0");
    return `${ymd[1]}-${month}-${day}`;
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export function parseTimestamp(v: string | null | undefined): string | null {
  const t = trimOrNull(v);
  if (!t) return null;
  const date = parseDate(t);
  if (date) return `${date}T00:00:00Z`;
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}
