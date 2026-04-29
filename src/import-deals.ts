import fs from "node:fs";
import Papa from "papaparse";
import {
  categorizeQuoteLost,
  normalizeLender,
  normalizeLoanType,
  normalizeLostReason,
  normalizePipelineStage,
  normalizePropertyType,
  normalizeQuoteStage,
  normalizeTransactionType,
  parseDate,
  parseMoney,
  parsePercent,
  trimOrNull,
  type DealLender,
  type DealLoanType,
  type DealLostReason,
  type DealPipelineStage,
  type DealPropertyType,
  type DealTransactionType,
  type QuoteLostCategory,
  type QuoteStage,
} from "./normalize.js";

export interface DealCsvRow {
  "Deal Sponsor"?: string;
  "Deal Address"?: string;
  "Deal Pipeline Entry Date"?: string;
  "Deal Lender"?: string;
  "Deal Transaction Type"?: string;
  "Deal Property Type"?: string;
  "Deal Loan Type"?: string;
  "Deal Pipeline Stage"?: string;
  "Deal Lost Reason"?: string;
  "Deal Lost Notes"?: string;
  "Deal Notes"?: string;
  "Date Deal Lost"?: string;
  "Loan Amount"?: string;
  "Origination %"?: string;
  "Origination $"?: string;
  "Interest Rate"?: string;
  "Cash to Close"?: string;
  "Quote Notes"?: string;
  "Quote Stage"?: string;
  "Quote Lost Reason"?: string;
  "Quote Lost Notes"?: string;
  "Date Quoted"?: string;
  "Date Quote Accepted"?: string;
  "Date Quote Lost"?: string;
}

export interface PreparedDeal {
  sponsor_legacy_name: string;
  sponsor_id: string | null;
  deal_address: string | null;
  deal_pipeline_entry_date: string;
  deal_lender: DealLender | null;
  deal_transaction_type: DealTransactionType | null;
  deal_property_type: DealPropertyType | null;
  deal_loan_type: DealLoanType | null;
  deal_pipeline_stage: DealPipelineStage;
  deal_lost_reason: DealLostReason | null;
  deal_lost_notes: string | null;
  deal_notes: string | null;
  date_deal_lost: string | null;
  loan_amount: number | null;
  origination_pct: number | null;
  origination_dollars: number | null;
  interest_rate: number | null;
  cash_to_close: number | null;
  date_quoted: string | null;
  quote_stage: QuoteStage | null;
  date_quote_accepted: string | null;
  date_quote_lost: string | null;
  quote_lost_reason: string | null;
  quote_lost_category: QuoteLostCategory | null;
  quote_lost_notes: string | null;
  quote_notes: string | null;
}

export interface DealNormalizationStats {
  quoteStageRefCoerced: number;
  quoteStageParsed: number;
  quoteLostCategories: Record<QuoteLostCategory | "null", number>;
  pipelineStageCounts: Map<DealPipelineStage, number>;
  unknownPipelineStages: Map<string, number>;
  rowsMissingEntryDate: number;
  orphans: PreparedDeal[];
}

export interface DealImportResult {
  rows: DealCsvRow[];
  prepared: PreparedDeal[];
  stats: DealNormalizationStats;
}

export function loadDealsCsv(path: string): DealCsvRow[] {
  const raw = fs.readFileSync(path, "utf8");
  const parsed = Papa.parse<DealCsvRow>(raw, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors.slice(0, 5)) {
      console.error(`pipeline.csv parse warning: ${e.message} (row ${e.row})`);
    }
  }
  return parsed.data.filter((r) => trimOrNull(r["Deal Sponsor"]) !== null);
}

export function buildDeals(
  rows: DealCsvRow[],
  sponsorNameToId: Map<string, string>,
): DealImportResult {
  const stats: DealNormalizationStats = {
    quoteStageRefCoerced: 0,
    quoteStageParsed: 0,
    quoteLostCategories: {
      Rejected: 0,
      Ghosted: 0,
      Pricing: 0,
      Other: 0,
      null: 0,
    },
    pipelineStageCounts: new Map(),
    unknownPipelineStages: new Map(),
    rowsMissingEntryDate: 0,
    orphans: [],
  };

  const prepared: PreparedDeal[] = [];

  for (const r of rows) {
    const sponsorRaw = (r["Deal Sponsor"] ?? "").trim();
    const sponsorKey = sponsorRaw.toLowerCase();
    const sponsorId = sponsorNameToId.get(sponsorKey) ?? null;

    const entryDate = parseDate(r["Deal Pipeline Entry Date"]);
    if (!entryDate) {
      stats.rowsMissingEntryDate++;
    }

    const stageRaw = trimOrNull(r["Deal Pipeline Stage"]);
    let stage = normalizePipelineStage(stageRaw) ?? null;
    if (stageRaw && !stage) {
      stats.unknownPipelineStages.set(
        stageRaw,
        (stats.unknownPipelineStages.get(stageRaw) ?? 0) + 1,
      );
    }
    const finalStage: DealPipelineStage = stage ?? "Just Added";
    stats.pipelineStageCounts.set(
      finalStage,
      (stats.pipelineStageCounts.get(finalStage) ?? 0) + 1,
    );

    const quoteStageRaw = trimOrNull(r["Quote Stage"]);
    let quoteStage: QuoteStage | null = null;
    if (quoteStageRaw === "#REF!") {
      stats.quoteStageRefCoerced++;
    } else if (quoteStageRaw) {
      quoteStage = normalizeQuoteStage(quoteStageRaw);
      if (quoteStage) stats.quoteStageParsed++;
    }

    const quoteLostReasonRaw = trimOrNull(r["Quote Lost Reason"]);
    const category = categorizeQuoteLost(quoteLostReasonRaw);
    if (category) stats.quoteLostCategories[category]++;
    else stats.quoteLostCategories.null++;

    const deal: PreparedDeal = {
      sponsor_legacy_name: sponsorRaw,
      sponsor_id: sponsorId,
      deal_address: trimOrNull(r["Deal Address"]),
      deal_pipeline_entry_date: entryDate ?? "1970-01-01",
      deal_lender: normalizeLender(r["Deal Lender"]),
      deal_transaction_type: normalizeTransactionType(r["Deal Transaction Type"]),
      deal_property_type: normalizePropertyType(r["Deal Property Type"]),
      deal_loan_type: normalizeLoanType(r["Deal Loan Type"]),
      deal_pipeline_stage: finalStage,
      deal_lost_reason: normalizeLostReason(r["Deal Lost Reason"]),
      deal_lost_notes: trimOrNull(r["Deal Lost Notes"]),
      deal_notes: trimOrNull(r["Deal Notes"]),
      date_deal_lost: parseDate(r["Date Deal Lost"]),
      loan_amount: parseMoney(r["Loan Amount"]),
      origination_pct: parsePercent(r["Origination %"]),
      origination_dollars: parseMoney(r["Origination $"]),
      interest_rate: parsePercent(r["Interest Rate"]),
      cash_to_close: parseMoney(r["Cash to Close"]),
      date_quoted: parseDate(r["Date Quoted"]),
      quote_stage: quoteStage,
      date_quote_accepted: parseDate(r["Date Quote Accepted"]),
      date_quote_lost: parseDate(r["Date Quote Lost"]),
      quote_lost_reason: quoteLostReasonRaw,
      quote_lost_category: category,
      quote_lost_notes: trimOrNull(r["Quote Lost Notes"]),
      quote_notes: trimOrNull(r["Quote Notes"]),
    };

    if (!sponsorId) stats.orphans.push(deal);
    prepared.push(deal);
  }

  return { rows, prepared, stats };
}

export function dealForInsert(d: PreparedDeal): Record<string, unknown> {
  const { sponsor_legacy_name, ...rest } = d;
  return rest;
}
