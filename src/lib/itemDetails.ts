import { safeExternalUrl } from "./privateImport.ts";

export const DETAIL_FIELDS = [
  ["location", "Τοποθεσία / διεύθυνση", 500],
  ["category", "Κατηγορία", 120],
  ["local_name", "Όνομα στην τοπική γλώσσα", 300],
  ["duration", "Διάρκεια", 300],
  ["hours", "Ώρες λειτουργίας", 2000],
  ["estimated_cost", "Ενδεικτικό κόστος", 2000],
  ["booking", "Κράτηση / εισιτήρια", 3000],
  ["transport", "Πώς φτάνουμε", 3000],
  ["tips", "Χρήσιμα / τι να προσέξουμε", 5000],
  ["alternative", "Εναλλακτική", 3000],
  ["website_url", "Σύνδεσμος πληροφοριών", 2000],
  ["map_url", "Σύνδεσμος χάρτη", 2000],
  ["image_url", "Σύνδεσμος φωτογραφίας (HTTPS)", 2000],
  ["image_credit", "Πηγή / δημιουργός φωτογραφίας", 500],
] as const;
export type DetailKey = (typeof DETAIL_FIELDS)[number][0];
export type ItemPresentation = Record<DetailKey, string> & { kind: string };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  if (Array.isArray(value))
    return value
      .filter((entry) => typeof entry === "string" || typeof entry === "number")
      .join(", ");
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** Display imported facts without altering the preserved original record. */
export function getItemPresentation(
  details: Record<string, unknown> = {},
  currency = "",
): ItemPresentation {
  const legacy = object(details.legacy_record);
  const custom = object(details.presentation);
  const range = [legacy.costMin, legacy.costMax]
    .filter((value) => typeof value === "number")
    .map(String)
    .join("–");
  const defaults: Partial<ItemPresentation> = {
    kind: "activity",
    location: text(legacy.area || legacy.city),
    category: text(legacy.category),
    local_name: text(legacy.zh),
    duration:
      typeof legacy.hours === "number"
        ? `${legacy.hours} ώρες`
        : text(legacy.time),
    hours: [
      text(legacy.opening_hours),
      text(legacy.closedDays) ? `Κλειστά: ${text(legacy.closedDays)}` : "",
      text(legacy.closureNote),
    ]
      .filter(Boolean)
      .join(" · "),
    estimated_cost: [
      range
        ? `${range} ${text(legacy.currency) || currency}`.trim()
        : text(legacy.cost),
      text(legacy.costNote),
      text(legacy.costStatus),
    ]
      .filter(Boolean)
      .join(" · "),
    booking: text(legacy.booking),
    transport: text(legacy.transport),
    tips: [
      legacy.needs,
      legacy.caution,
      legacy.warning,
      legacy.difficulty,
      legacy.weather,
    ]
      .map(text)
      .filter(Boolean)
      .join("\n"),
    alternative: text(legacy.alternative),
  };
  const kind = text(custom.kind);
  const result = {
    kind: ["activity", "place", "food"].includes(kind) ? kind : "activity",
  } as ItemPresentation;
  for (const [key] of DETAIL_FIELDS) {
    // An explicitly cleared value must stay blank when editing an import.
    result[key] = Object.hasOwn(custom, key)
      ? text(custom[key])
      : text(defaults[key]);
  }
  return result;
}

export function saveItemPresentation(
  details: Record<string, unknown>,
  values: ItemPresentation,
): Record<string, unknown> {
  if (!["activity", "place", "food"].includes(values.kind))
    throw new Error("Διάλεξε είδος πρότασης.");
  const clean: Record<string, string> = { kind: values.kind };
  for (const [key, label, max] of DETAIL_FIELDS) {
    const value = values[key].trim();
    if (value.length > max)
      throw new Error(`Το πεδίο «${label}» είναι πολύ μεγάλο.`);
    if (value && key.endsWith("_url")) {
      const url = safeExternalUrl(value);
      if (!url || (key === "image_url" && new URL(url).protocol !== "https:"))
        throw new Error(
          `Έλεγξε το πεδίο «${label}»: χρειάζεται έγκυρος ${key === "image_url" ? "HTTPS" : "HTTP ή HTTPS"} σύνδεσμος.`,
        );
    }
    clean[key] = value;
  }
  const result = {
    ...details,
    presentation: { ...object(details.presentation), ...clean },
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 100 * 1024)
    throw new Error(
      "Οι πρόσθετες πληροφορίες υπερβαίνουν το επιτρεπόμενο μέγεθος.",
    );
  return result;
}

export function getItemSources(details: Record<string, unknown>) {
  const sources = Array.isArray(details.sources) ? details.sources : [];
  return sources.flatMap((entry) => {
    const wrapper = object(entry);
    const source = Object.hasOwn(wrapper, "source")
      ? object(wrapper.source)
      : wrapper;
    const url = safeExternalUrl(
      typeof entry === "string" ? entry : text(source.url),
    );
    return url
      ? [
          {
            url,
            title: text(source.title) || new URL(url).hostname,
            checked: text(source.checked),
          },
        ]
      : [];
  });
}

export function safeImageUrl(value: string): string | null {
  const url = safeExternalUrl(value);
  return url && new URL(url).protocol === "https:" ? url : null;
}
