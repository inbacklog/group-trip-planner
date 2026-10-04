import type {
  ImportEntry,
  JsonValue,
  PrivateTripImport,
} from "./privateImport";

/** A format identifier only: real travel data never belongs in this module. */
export const LEGACY_HANDOFF_FORMAT = "project-china-private-handoff-v1";
const MAX_TRIP_DETAILS_BYTES = 512 * 1024;
const AUTHORITY_FIELDS = new Set([
  "id",
  "group_id",
  "user_id",
  "owner_id",
  "created_by",
  "role",
  "roles",
  "members",
  "users",
  "participants",
  "memberships",
  "group_members",
  "auth_users",
]);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
type JsonObject = { [key: string]: JsonValue };
type LegacyImportResult = Omit<PrivateTripImport, "trip"> & {
  trip: PrivateTripImport["trip"] & { details: JsonObject };
};

function fail(
  message = "Το παλιό αρχείο ταξιδιού έχει μη υποστηριζόμενη δομή.",
): never {
  // Never interpolate private values, source IDs, filenames or record content.
  throw new Error(message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail();
  return value;
}
function text(value: unknown, required = false): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || (required && !value.trim())) fail();
  return value;
}
function assertNoAuthority(value: Record<string, unknown>) {
  if (Object.keys(value).some((key) => UNSAFE_KEYS.has(key)))
    fail("Μη επιτρεπόμενο όνομα πεδίου στο παλιό αρχείο.");
  if (
    Object.keys(value).some((key) => AUTHORITY_FIELDS.has(key.toLowerCase()))
  ) {
    fail(
      "Το παλιό αρχείο δεν μπορεί να ορίζει χρήστες, ταυτότητες ή δικαιώματα.",
    );
  }
}
function cloneJson(value: unknown, depth = 0): JsonValue {
  if (depth > 16) fail("Το παλιό αρχείο έχει υπερβολικά πολλά επίπεδα.");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((entry) => cloneJson(entry, depth + 1));
  const result: JsonObject = Object.create(null);
  for (const [key, entry] of Object.entries(object(value))) {
    if (UNSAFE_KEYS.has(key))
      fail("Μη επιτρεπόμενο όνομα πεδίου στο παλιό αρχείο.");
    result[key] = cloneJson(entry, depth + 1);
  }
  return result;
}
function jsonObject(value: unknown): JsonObject {
  object(value);
  return cloneJson(value) as JsonObject;
}

/**
 * Converts a private legacy handoff to the public import schema. The canonical
 * parser still validates field limits, currencies, timezones, URLs and sizes.
 * Legacy IDs, votes, people counts and draft days remain inert reference data.
 */
export function convertLegacyImport(decoded: unknown): LegacyImportResult {
  const root = object(decoded);
  if (root.handoffFormat !== LEGACY_HANDOFF_FORMAT)
    fail("Μη υποστηριζόμενη έκδοση παλιού αρχείου ταξιδιού.");
  assertNoAuthority(root);
  text(root.classification, true);
  object(root.provenance);
  const trip = object(root.trip);
  const dataset = object(root.legacyDataset);
  assertNoAuthority(trip);
  assertNoAuthority(dataset);
  object(dataset.meta);
  object(dataset.feeGroups);
  list(dataset.days);
  const sourceValues = object(dataset.sources);
  const sources = new Map<string, JsonObject>();
  for (const [reference, value] of Object.entries(sourceValues)) {
    if (!reference.trim() || UNSAFE_KEYS.has(reference))
      fail("Μη έγκυρος κατάλογος πηγών στο παλιό αρχείο.");
    sources.set(reference, jsonObject(value));
  }
  const activities = list(dataset.activities).map(object);
  const hotels = list(dataset.hotels).map(object);
  const transfers = list(dataset.transfers).map(object);

  const stops: PrivateTripImport["stops"] = [];
  const cityKeys = new Map<string, string>();
  for (const entry of [...activities, ...hotels]) {
    const city = text(entry.city).trim();
    if (city && !cityKeys.has(city)) {
      const key = `legacy-stop-${stops.length + 1}`;
      cityKeys.set(city, key);
      stops.push({ key, name: city });
    }
  }

  function entryDetails(entry: Record<string, unknown>): JsonObject {
    const references = entry.sources === undefined ? [] : list(entry.sources);
    const resolved = references.map((reference) => {
      if (typeof reference !== "string" || !sources.has(reference)) {
        fail(
          "Μια αναφορά πηγής του παλιού αρχείου δεν υπάρχει στον κατάλογο πηγών.",
        );
      }
      return { reference, source: cloneJson(sources.get(reference)) };
    });
    return { legacy_record: jsonObject(entry), sources: resolved };
  }
  function convertEntry(
    entry: Record<string, unknown>,
    kind: "activity" | "hotel" | "transfer",
  ): ImportEntry {
    const result: ImportEntry = {
      title: text(
        entry[
          kind === "activity" ? "title" : kind === "hotel" ? "name" : "route"
        ],
        true,
      ),
      description:
        kind === "activity"
          ? text(entry.description)
          : kind === "hotel"
            ? [text(entry.why), text(entry.caution)]
                .filter(Boolean)
                .join("\n\n")
            : [text(entry.main), text(entry.alternative), text(entry.warning)]
                .filter(Boolean)
                .join("\n\n"),
      details: entryDetails(entry),
    };
    if (kind === "activity") result.why_visit = text(entry.why);
    const city = text(entry.city).trim();
    const stopKey = cityKeys.get(city);
    if (stopKey) result.stop_key = stopKey;
    return result;
  }

  // Preserve all original fields without duplicating the large record arrays.
  // Reassembling legacy_handoff plus each legacy_record recovers the input.
  const handoff: JsonObject = Object.create(null);
  for (const [key, value] of Object.entries(root)) {
    if (key !== "legacyDataset") handoff[key] = cloneJson(value);
  }
  const datasetMetadata: JsonObject = Object.create(null);
  for (const [key, value] of Object.entries(dataset)) {
    if (!["activities", "hotels", "transfers"].includes(key))
      datasetMetadata[key] = cloneJson(value);
  }
  handoff.legacyDataset = datasetMetadata;
  const details: JsonObject = {
    legacy_handoff: handoff,
    import_context: {
      party_size_is_assumption: true,
      draft_days_are_reference_only: true,
      sources_reverified_during_import: false,
      creates_members_or_votes: false,
      creates_schedule_or_approvals: false,
    },
  };
  if (
    new TextEncoder().encode(JSON.stringify(details)).byteLength >
    MAX_TRIP_DETAILS_BYTES
  ) {
    fail("Τα στοιχεία αναφοράς του παλιού ταξιδιού υπερβαίνουν τα 512 KiB.");
  }
  return {
    schema_version: 1,
    kind: "private-trip",
    trip: {
      name: text(trip.title, true),
      currency: text(trip.currency, true),
      timezone: text(trip.timezone, true),
      details,
    },
    stops,
    activities: activities.map((entry) => convertEntry(entry, "activity")),
    lodgings: hotels.map((entry) => convertEntry(entry, "hotel")),
    transfers: transfers.map((entry) => convertEntry(entry, "transfer")),
  };
}
