import { env } from "./env.js";

const FUB_BASE = "https://api.followupboss.com/v1";

export interface FubEmail {
  value: string;
  type?: string;
  isPrimary?: number | boolean;
}

export interface FubPhone {
  value: string;
  type?: string;
  isPrimary?: number | boolean;
}

export interface FubPerson {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  emails?: FubEmail[];
  phones?: FubPhone[];
  stage?: string | null;
  stageId?: number | null;
  created?: string | null;
}

interface FubPeopleResponse {
  _metadata?: {
    next?: string | null;
    nextLink?: string | null;
    total?: number;
  };
  people?: FubPerson[];
}

function authHeader(): string {
  const token = Buffer.from(`${env.FUB_API_KEY}:`).toString("base64");
  return `Basic ${token}`;
}

async function fetchWithRetry(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  });
  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    if (attempt < 4) {
      const wait = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));
      return fetchWithRetry(url, attempt + 1);
    }
  }
  return res;
}

export async function fetchAllPeople(opts: {
  onProgress?: (count: number) => void;
} = {}): Promise<FubPerson[]> {
  const fields = [
    "id",
    "firstName",
    "lastName",
    "name",
    "emails",
    "phones",
    "stage",
    "stageId",
    "created",
  ].join(",");

  const all: FubPerson[] = [];
  let next: string | null = `${FUB_BASE}/people?limit=100&fields=${encodeURIComponent(fields)}&sort=created`;

  while (next) {
    const res: Response = await fetchWithRetry(next);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`FUB /people failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as FubPeopleResponse;
    const batch = json.people ?? [];
    all.push(...batch);
    if (opts.onProgress) opts.onProgress(all.length);

    const nextToken: string | null | undefined = json._metadata?.next;
    const nextLink: string | null | undefined = json._metadata?.nextLink;

    if (nextLink) {
      next = nextLink;
    } else if (nextToken) {
      next = `${FUB_BASE}/people?limit=100&fields=${encodeURIComponent(fields)}&sort=created&next=${encodeURIComponent(nextToken)}`;
    } else {
      next = null;
    }
  }

  return all;
}

export function fubPersonUrl(id: number): string {
  return `https://lennoxlending.followupboss.com/2/people/view/${id}`;
}

export function primaryEmail(p: FubPerson): string | null {
  if (!p.emails || p.emails.length === 0) return null;
  const primary = p.emails.find((e) => e.isPrimary);
  return (primary ?? p.emails[0])?.value ?? null;
}

export function primaryPhone(p: FubPerson): string | null {
  if (!p.phones || p.phones.length === 0) return null;
  const primary = p.phones.find((e) => e.isPrimary);
  return (primary ?? p.phones[0])?.value ?? null;
}
