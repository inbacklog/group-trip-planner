/** Public format only. Real trip files stay outside source control and the build. */
import { convertLegacyImport } from "./legacyImport.ts";
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type ImportEntry = {
  title: string;
  stop_key?: string;
  description?: string;
  why_visit?: string;
  details: { [key: string]: JsonValue };
};
export type PrivateTripImport = {
  schema_version: 1;
  kind: "private-trip";
  trip: {
    name: string;
    currency: string;
    timezone: string;
    details?: { [key: string]: JsonValue };
  };
  stops: { key: string; name: string }[];
  activities: ImportEntry[];
  lodgings: ImportEntry[];
  transfers: ImportEntry[];
};

function fail(message: string): never {
  throw new Error(message);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label}: αναμένεται αντικείμενο.`);
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    fail(
      `${label}: μη υποστηριζόμενα πεδία. Χρησιμοποίησε τη μορφή private-trip v1. Δεν εισάγονται χρήστες ή δικαιώματα.`,
    );
  }
}
function string(
  value: unknown,
  label: string,
  max: number,
  optional = false,
): string {
  if (value === undefined && optional) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!optional && !value.trim())
  ) {
    fail(`${label}: χρειάζεται κείμενο έως ${max} χαρακτήρες.`);
  }
  return value as string;
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    fail(`${label}: αναμένεται λίστα έως ${max} εγγραφές.`);
  return value as unknown[];
}

/** Never render untrusted links without this allowlist, even after import. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function metadata(value: unknown, depth = 0, key = ""): JsonValue {
  if (depth > 12) fail("Τα επιπλέον στοιχεία έχουν υπερβολικά πολλά επίπεδα.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    if (value.length > 20000)
      fail("Ένα πεδίο επιπλέον στοιχείων υπερβαίνει το όριο κειμένου.");
    if (/(^url$|^href$|_url$)/i.test(key) && value && !safeExternalUrl(value)) {
      fail(
        "Οι σύνδεσμοι πρέπει να χρησιμοποιούν http ή https, χωρίς ενσωματωμένους κωδικούς.",
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 2000)
      fail("Μια λίστα επιπλέον στοιχείων υπερβαίνει το όριο.");
    return value.map((item) => metadata(item, depth + 1));
  }
  const object = record(value, "Επιπλέον στοιχεία");
  if (Object.keys(object).length > 100)
    fail("Πάρα πολλά πεδία επιπλέον στοιχείων.");
  const result: { [key: string]: JsonValue } = Object.create(null);
  for (const [name, item] of Object.entries(object)) {
    if (["__proto__", "constructor", "prototype"].includes(name))
      fail("Μη επιτρεπόμενο όνομα πεδίου.");
    if (name.length > 120) fail("Υπερβολικά μεγάλο όνομα πεδίου.");
    result[name] = metadata(item, depth + 1, name);
  }
  return result;
}

export function parsePrivateImport(text: string): PrivateTripImport {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES)
    fail("Το αρχείο πρέπει να είναι έως 2 MB.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    fail("Το αρχείο δεν είναι έγκυρο JSON.");
  }
  const root = record(decoded, "Αρχείο");
  if (root.handoffFormat === "project-china-private-handoff-v1") {
    return parsePrivateImport(JSON.stringify(convertLegacyImport(root)));
  }
  keys(
    root,
    [
      "schema_version",
      "kind",
      "trip",
      "stops",
      "activities",
      "lodgings",
      "transfers",
    ],
    "Αρχείο",
  );
  if (root.schema_version !== 1 || root.kind !== "private-trip") {
    fail(
      "Υποστηρίζεται η μορφή private-trip v1. Το παλιό αρχείο χρειάζεται πρώτα αντιστοίχιση πεδίων.",
    );
  }
  const trip = record(root.trip, "Ταξίδι");
  keys(trip, ["name", "currency", "timezone", "details"], "Ταξίδι");
  const name = string(trip.name, "Όνομα ταξιδιού", 120).trim();
  const currency =
    trip.currency === undefined ? "EUR" : string(trip.currency, "Νόμισμα", 3);
  if (!/^[A-Z]{3}$/.test(currency))
    fail("Το νόμισμα χρειάζεται τρία κεφαλαία λατινικά γράμματα.");
  const timezone =
    trip.timezone === undefined
      ? "UTC"
      : string(trip.timezone, "Ζώνη ώρας", 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    fail("Μη έγκυρη ζώνη ώρας.");
  }
  const tripDetails = metadata(
    record(trip.details ?? {}, "Πληροφορίες ταξιδιού"),
  ) as { [key: string]: JsonValue };
  if (
    new TextEncoder().encode(JSON.stringify(tripDetails)).byteLength >
    512 * 1024
  ) {
    fail("Οι πληροφορίες του ταξιδιού υπερβαίνουν τα 512 KB.");
  }
  const stopKeys = new Set<string>();
  const stops = array(root.stops, "Στάσεις", 100).map((value) => {
    const stop = record(value, "Στάση");
    keys(stop, ["key", "name"], "Στάση");
    const key = string(stop.key, "Κλειδί στάσης", 100);
    if (stopKeys.has(key)) fail("Κάθε στάση χρειάζεται μοναδικό κλειδί.");
    stopKeys.add(key);
    return { key, name: string(stop.name, "Όνομα στάσης", 120).trim() };
  });
  function entries(
    value: unknown,
    label: string,
    max: number,
    activity = false,
  ): ImportEntry[] {
    return array(value, label, max).map((item) => {
      const entry = record(item, label);
      keys(
        entry,
        [
          "title",
          "stop_key",
          "description",
          ...(activity ? ["why_visit"] : []),
          "details",
        ],
        label,
      );
      const result: ImportEntry = {
        title: string(entry.title, "Τίτλος", 200).trim(),
        details: metadata(
          record(entry.details ?? {}, "Επιπλέον στοιχεία"),
        ) as ImportEntry["details"],
      };
      if (
        new TextEncoder().encode(JSON.stringify(result.details)).byteLength >
        100 * 1024
      ) {
        fail("Τα επιπλέον στοιχεία μίας εγγραφής υπερβαίνουν τα 100 KB.");
      }
      if (entry.stop_key !== undefined) {
        result.stop_key = string(entry.stop_key, "Σύνδεση στάσης", 100);
        if (!stopKeys.has(result.stop_key))
          fail("Μια εγγραφή αναφέρεται σε στάση που δεν υπάρχει στο αρχείο.");
      }
      if (entry.description !== undefined)
        result.description = string(
          entry.description,
          "Περιγραφή",
          20000,
          true,
        );
      if (entry.why_visit !== undefined)
        result.why_visit = string(entry.why_visit, "Γιατί αξίζει", 10000, true);
      return result;
    });
  }
  return {
    schema_version: 1,
    kind: "private-trip",
    trip: { name, currency, timezone, details: tripDetails },
    stops,
    activities: entries(root.activities, "Προτάσεις", 1000, true),
    lodgings: entries(root.lodgings, "Διαμονές", 200),
    transfers: entries(root.transfers, "Μετακινήσεις", 200),
  };
}

export function getImportSummary(payload: PrivateTripImport) {
  return {
    name: payload.trip.name,
    stops: payload.stops.length,
    activities: payload.activities.length,
    lodgings: payload.lodgings.length,
    transfers: payload.transfers.length,
  };
}
