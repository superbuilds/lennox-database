import type { FubPerson } from "./fub.js";

export type FubMatchKind = "exact_unique" | "exact_ambiguous_resolved" | "none";

export interface MatchResult {
  kind: FubMatchKind;
  person: FubPerson | null;
  candidates: FubPerson[];
  note: string | null;
}

const STAGE_PRIORITY: Record<number, number> = {
  106: 100,
  107: 90,
  97: 85,
  27: 80,
  113: 50,
  112: 50,
  108: 70,
  31: 60,
  2: 50,
  104: 40,
  28: 30,
  30: 30,
  111: 30,
  110: 30,
  114: 10,
  116: 0,
  11: 0,
  8: 0,
};

function stagePriority(p: FubPerson): number {
  const id = p.stageId;
  if (id == null) return -1;
  return STAGE_PRIORITY[id] ?? -1;
}

function nameKey(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildNameIndex(
  people: FubPerson[],
): Map<string, FubPerson[]> {
  const idx = new Map<string, FubPerson[]>();
  for (const p of people) {
    const key = nameKey(p.name);
    if (!key) continue;
    const list = idx.get(key);
    if (list) list.push(p);
    else idx.set(key, [p]);
  }
  return idx;
}

export function matchSponsor(
  sponsorName: string,
  index: Map<string, FubPerson[]>,
): MatchResult {
  const key = nameKey(sponsorName);
  if (!key) {
    return { kind: "none", person: null, candidates: [], note: null };
  }
  const candidates = index.get(key) ?? [];
  if (candidates.length === 0) {
    return { kind: "none", person: null, candidates: [], note: null };
  }
  if (candidates.length === 1) {
    return {
      kind: "exact_unique",
      person: candidates[0]!,
      candidates,
      note: null,
    };
  }
  const sorted = [...candidates].sort((a, b) => {
    const pa = stagePriority(a);
    const pb = stagePriority(b);
    if (pa !== pb) return pb - pa;
    const ca = a.created ? Date.parse(a.created) : 0;
    const cb = b.created ? Date.parse(b.created) : 0;
    return cb - ca;
  });
  const winner = sorted[0]!;
  const ids = candidates.map((c) => c.id).join(", ");
  return {
    kind: "exact_ambiguous_resolved",
    person: winner,
    candidates,
    note: `Ambiguous FUB match: ${candidates.length} candidates [${ids}], picked id=${winner.id} via stage priority`,
  };
}

export function findCsvDuplicates(names: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const n of names) {
    const key = nameKey(n);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [k, c] of counts) {
    if (c > 1) dupes.add(k);
  }
  return dupes;
}

export function isDuplicateName(
  name: string,
  dupes: Set<string>,
): boolean {
  return dupes.has(nameKey(name));
}
