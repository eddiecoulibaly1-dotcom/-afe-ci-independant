/**
 * External market feed adapter.
 *
 * The public OCPV and SIMAgri pages currently expose human-readable web pages
 * and downloadable bulletins; no documented public JSON API was identified.
 * This adapter therefore accepts a controlled JSON feed supplied by an
 * authorized source/export, without scraping undocumented page internals.
 */
import type { MarketObservation, SourceClass } from "./market-intelligence.js";

const SOURCE_CLASSES = new Set<SourceClass>([
  "government", "public_market_system", "official_supplier", "producer",
  "marketplace", "press", "technical_publication", "unknown"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Observation de marché invalide : champ ${field} absent.`);
  }
  return value.trim();
}

export function validateMarketObservation(value: unknown): MarketObservation {
  if (!isRecord(value)) throw new Error("Observation de marché invalide : objet attendu.");
  const numeric = value.value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric < 0) {
    throw new Error("Observation de marché invalide : valeur numérique positive ou nulle attendue.");
  }
  const sourceUrl = requiredString(value.sourceUrl, "sourceUrl");
  let parsedUrl: URL;
  try { parsedUrl = new URL(sourceUrl); } catch { throw new Error("URL de source invalide."); }
  if (parsedUrl.protocol !== "https:") throw new Error("La source doit utiliser HTTPS.");
  const sourceClass = requiredString(value.sourceClass, "sourceClass") as SourceClass;
  if (!SOURCE_CLASSES.has(sourceClass)) throw new Error("Classe de source inconnue.");
  const kind = requiredString(value.kind, "kind");
  const allowedKinds = new Set(["input_purchase", "feed", "raw_material", "sale_price", "transport", "energy", "labor", "health", "equipment"]);
  if (!allowedKinds.has(kind)) throw new Error("Type de prix inconnu.");
  const publishedAt = typeof value.publishedAt === "string" && value.publishedAt.trim() ? value.publishedAt.trim() : undefined;
  const observedAt = typeof value.observedAt === "string" && value.observedAt.trim() ? value.observedAt.trim() : undefined;
  const retrievedAt = requiredString(value.retrievedAt, "retrievedAt");
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new Error("Date de collecte invalide.");
  if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) throw new Error("Date de publication invalide.");
  if (observedAt && !Number.isFinite(Date.parse(observedAt))) throw new Error("Date d'observation invalide.");
  return {
    id: requiredString(value.id, "id"),
    product: requiredString(value.product, "product"),
    normalizedProduct: requiredString(value.normalizedProduct, "normalizedProduct"),
    kind: kind as MarketObservation["kind"],
    value: numeric,
    currency: requiredString(value.currency, "currency"),
    unit: requiredString(value.unit, "unit"),
    country: requiredString(value.country, "country"),
    region: typeof value.region === "string" ? value.region : undefined,
    city: typeof value.city === "string" ? value.city : undefined,
    sourceName: requiredString(value.sourceName, "sourceName"),
    sourceUrl,
    sourceClass,
    publishedAt,
    observedAt,
    retrievedAt,
    validUntil: typeof value.validUntil === "string" ? value.validUntil : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined
  };
}

export interface MarketFeedResponse {
  observations: MarketObservation[];
  source: string;
  retrievedAt: string;
}

/** Fetch a configured partner/export endpoint. URL and token are server-side environment settings only. */
export async function fetchConfiguredMarketFeed(
  fetcher: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env
): Promise<MarketFeedResponse> {
  const endpoint = env.MARKET_PRICE_FEED_URL?.trim();
  if (!endpoint) throw new Error("MARKET_PRICE_FEED_URL n'est pas configurée.");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("MARKET_PRICE_FEED_URL est invalide."); }
  if (url.protocol !== "https:") throw new Error("Le flux de prix doit être servi en HTTPS.");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.MARKET_PRICE_FEED_TOKEN) headers.Authorization = `Bearer ${env.MARKET_PRICE_FEED_TOKEN}`;
  const response = await fetcher(url, { method: "GET", headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Flux de prix indisponible (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.observations)) {
    throw new Error("Format du flux invalide : tableau observations attendu.");
  }
  const observations = payload.observations.map(validateMarketObservation);
  const retrievedAt = new Date().toISOString();
  return {
    observations,
    source: typeof payload.source === "string" && payload.source.trim() ? payload.source.trim() : url.hostname,
    retrievedAt
  };
}

/** Parse a UTF-8 CSV export with the exact field names used by MarketObservation. */
export function parseMarketCsv(csv: string): MarketObservation[] {
  const rows = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (rows.length < 2) return [];
  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
      else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  };
  const headers = parseRow(rows[0]);
  const required = ["id","product","normalizedProduct","kind","value","currency","unit","country","sourceName","sourceUrl","sourceClass","retrievedAt"];
  for (const field of required) if (!headers.includes(field)) throw new Error(`Colonne CSV obligatoire absente : ${field}.`);
  return rows.slice(1).map((line, index) => {
    const cells = parseRow(line);
    const record: Record<string, unknown> = {};
    headers.forEach((header, i) => { record[header] = header === "value" ? Number(cells[i]) : (cells[i] || undefined); });
    try { return validateMarketObservation(record); }
    catch (error) { throw new Error(`Ligne CSV ${index + 2} : ${error instanceof Error ? error.message : String(error)}`); }
  });
}
