/** Monetary source data is never overwritten by a converted EUR display. */
export type CostUnit = "unknown" | "per_person" | "per_group" | "per_vehicle" | "per_room_per_night";
export type Cost = { min: number | null; max: number | null; currency: string; unit: CostUnit };
export type CostDraft = { min: string; max: string; currency: string; unit: CostUnit };
export const COST_UNITS: Record<CostUnit, string> = {
  unknown: "Μονάδα χρέωσης μη δηλωμένη",
  per_person: "ανά άτομο", per_group: "ανά παρέα", per_vehicle: "ανά όχημα",
  per_room_per_night: "ανά δωμάτιο / νύχτα",
};
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const amount = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e12 ? v : null;
export function normalizeCurrency(v: unknown): string {
  const code = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (code === "RMB") return "CNY";
  if (code === "€") return "EUR";
  return /^[A-Z]{3}$/.test(code) ? code : "";
}
function unit(v: unknown): CostUnit {
  return typeof v === "string" && Object.hasOwn(COST_UNITS, v) ? v as CostUnit : "unknown";
}
function validRange(cost: Cost): Cost | null {
  if ((cost.min === null && cost.max === null) || (cost.min !== null && cost.max !== null && cost.max < cost.min)) return null;
  return cost;
}
/** Deliberately conservative: never extract numbers from mixed fees, dates or arbitrary prose. */
export function parseSimplePrice(text: string, fallbackCurrency: string): Cost | null {
  const primary = text.split(/\s+·\s+/)[0].trim();
  const m = primary.match(/^(?:(EUR|CNY|RMB|USD|GBP|€)\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*[–—-]\s*(\d+(?:[.,]\d{1,2})?))?\s*(EUR|CNY|RMB|USD|GBP|€)?(?:\s*\/\s*(άτομο|ατομο|person|παρέα|παρεα|group|όχημα|οχημα|vehicle|δωμάτιο\/νύχτα))?$/iu);
  if (!m || (m[1] && m[4] && normalizeCurrency(m[1]) !== normalizeCurrency(m[4]))) return null;
  const min = amount(Number(m[2].replace(",", ".")));
  const max = m[3] ? amount(Number(m[3].replace(",", "."))) : min;
  const units: Record<string, CostUnit> = { "άτομο": "per_person", "ατομο": "per_person", person: "per_person", "παρέα": "per_group", "παρεα": "per_group", group: "per_group", "όχημα": "per_vehicle", "οχημα": "per_vehicle", vehicle: "per_vehicle", "δωμάτιο/νύχτα": "per_room_per_night" };
  return validRange({ min, max, currency: normalizeCurrency(m[1] || m[4] || fallbackCurrency), unit: units[(m[5] || "").toLowerCase()] || "unknown" });
}
export function getCost(details: Record<string, unknown> = {}, fallbackCurrency = ""): Cost | null {
  // An explicitly cleared structured value must not resurrect a legacy estimate.
  if (Object.hasOwn(details, "money")) {
    const c = record(details.money);
    if ((c.min != null && amount(c.min) === null) || (c.max != null && amount(c.max) === null)) return null;
    return validRange({ min: amount(c.min), max: amount(c.max), currency: normalizeCurrency(c.currency), unit: unit(c.unit) });
  }
  const presentation = record(details.presentation);
  if (Object.hasOwn(presentation, "estimated_cost")) {
    return typeof presentation.estimated_cost === "string" ? parseSimplePrice(presentation.estimated_cost, fallbackCurrency) : null;
  }
  const legacy = record(details.legacy_record);
  if (/unknown|άγνωστ|αγνωστ|μη διαθέσιμ/iu.test(String(legacy.costStatus ?? ""))) return null;
  if ((legacy.costMin != null && amount(legacy.costMin) === null) || (legacy.costMax != null && amount(legacy.costMax) === null)) return null;
  const min = amount(legacy.costMin), max = amount(legacy.costMax);
  if (min !== null || max !== null) return validRange({ min, max, currency: normalizeCurrency(legacy.currency || fallbackCurrency), unit: unit(legacy.costUnit) });
  return typeof legacy.cost === "string" ? parseSimplePrice(legacy.cost, normalizeCurrency(legacy.currency || fallbackCurrency)) : null;
}
export function toCostDraft(details: Record<string, unknown> = {}, currency = ""): CostDraft {
  const c = getCost(details, currency);
  return { min: c?.min?.toString() ?? "", max: c?.max?.toString() ?? "", currency: c?.currency || normalizeCurrency(currency) || "EUR", unit: c?.unit ?? "unknown" };
}
export function saveCostDraft(d: CostDraft): Cost | null {
  const parse = (v: string) => {
    if (!v.trim()) return null;
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(v.trim())) throw new Error("Το ποσό πρέπει να είναι θετικός αριθμός ή 0, με έως δύο δεκαδικά.");
    const n = amount(Number(v.trim().replace(",", ".")));
    if (n === null) throw new Error("Το ποσό είναι εκτός επιτρεπτού εύρους.");
    return n;
  };
  const min = parse(d.min), max = parse(d.max);
  if (min === null && max === null) return null;
  const currency = normalizeCurrency(d.currency);
  if (!currency) throw new Error("Συμπλήρωσε νόμισμα τριών γραμμάτων, π.χ. CNY ή EUR.");
  if (min !== null && max !== null && max < min) throw new Error("Το μέγιστο ποσό δεν μπορεί να είναι μικρότερο από το ελάχιστο.");
  return { min, max: max ?? min, currency, unit: unit(d.unit) };
}
export function formatCost(cost: Cost, multiplier = 1, currency = cost.currency): string {
  const format = (n: number) => {
    const value = n * multiplier;
    if (!Number.isFinite(value)) return "Μη διαθέσιμο";
    return new Intl.NumberFormat("el-GR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  };
  const range = cost.min === null ? `έως ${format(cost.max!)}`
    : cost.max === null ? `από ${format(cost.min)}`
    : cost.min === cost.max ? format(cost.min) : `${format(cost.min)}–${format(cost.max)}`;
  return `${range} ${currency === "EUR" ? "€" : currency || "(χωρίς νόμισμα)"}`;
}
export type FxRate = { base: string; quote: "EUR"; rate: number; date: string; fetchedAt: number };
export const FX_SOURCE_URL = "https://frankfurter.dev/";
export const FX_SOURCE_NAME = "ΕΚΤ μέσω Frankfurter";
export function parseFxRate(data: unknown, base: string, now = Date.now()): FxRate {
  const value = record(data), date = String(value.date ?? "");
  const parsedDate = Date.parse(`${date}T00:00:00Z`);
  if (normalizeCurrency(value.base) !== base || normalizeCurrency(value.quote) !== "EUR"
    || typeof value.rate !== "number" || !Number.isFinite(value.rate) || value.rate <= 0
    || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate)
    || new Date(parsedDate).toISOString().slice(0,10) !== date || parsedDate > now + 86400000) {
    throw new Error("Μη έγκυρη απάντηση ισοτιμίας.");
  }
  return { base, quote: "EUR", rate: value.rate, date, fetchedAt: now };
}
export function isOldRate(rate: FxRate, now = Date.now()) {
  return now - Date.parse(`${rate.date}T00:00:00Z`) > 7 * 86400000;
}
