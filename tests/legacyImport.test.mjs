import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertLegacyImport,
  LEGACY_HANDOFF_FORMAT,
} from "../src/lib/legacyImport.ts";

// Synthetic data only. Do not replace this fixture with a real handoff.
function fixture() {
  return {
    handoffFormat: LEGACY_HANDOFF_FORMAT,
    classification: "private-test-data",
    trip: {
      title: "Synthetic journey",
      timezone: "UTC",
      currency: "EUR",
      partySize: 3,
      planningDates: {
        firstLocalDate: "2031-01-01",
        lastLocalDate: "2031-01-03",
      },
      anchors: [{ kind: "arrival", status: "unconfirmed", city: "Sample Bay" }],
      preferredRoute: ["Sample Hill", "Sample Bay"],
      routeStatus: "proposal",
      mustVisit: [{ name: "Synthetic place", status: "idea" }],
      knownUnknowns: ["Arrival time"],
      notes: ["Reference only"],
      extraTrip: { retained: true },
    },
    legacyDataset: {
      meta: {
        title: "Synthetic catalogue",
        version: "old",
        members: 3,
        checked: "2020-01-01",
      },
      sources: {
        "source-a": {
          title: "Synthetic reference",
          url: "https://example.com/a",
          checked: "2020-01-01",
          extra: "kept",
        },
        "source-b": {
          title: "Other reference",
          url: "https://example.com/b",
          status: "unverified",
        },
      },
      activities: [
        {
          id: "old-a",
          city: " Sample Bay ",
          title: "Synthetic walk",
          description: "A full description",
          why: "A reason",
          sources: ["source-a", "source-b"],
          feeKey: "fee-a",
          votes: { "legacy-slot-1": true },
          extra: { count: null },
        },
        {
          id: "old-b",
          city: "Sample Bay",
          title: "Synthetic picnic",
          description: "",
          why: "",
          sources: ["source-a"],
        },
        { id: "old-c", city: "", title: "Unassigned idea", sources: [] },
      ],
      hotels: [
        {
          id: "old-h",
          city: "Sample Hill",
          name: "Synthetic lodging",
          why: "Convenient",
          caution: "Check capacity",
          room: "Unknown",
          sources: ["source-b"],
        },
      ],
      transfers: [
        {
          id: "old-t",
          route: "Synthetic connection",
          main: "Option A",
          alternative: "Option B",
          warning: "Verify times",
          sources: ["source-a"],
        },
      ],
      days: [
        {
          date: "2031-01-01",
          city: "Sample Bay",
          title: "Draft day",
          activities: ["old-a"],
          alternatives: ["old-b"],
          note: "Not approved",
        },
      ],
      feeGroups: {
        "fee-a": { title: "Example fee", min: null, max: 20, note: "Estimate" },
      },
      extraDataset: { custom: ["preserved"] },
    },
    provenance: {
      legacyVerifiedAtValuesAreNotReverified: true,
      legacyItineraryIsAssistantDraftNotGroupApproval: true,
      doNotAutoCreateRealUsersFromLegacySlots: true,
    },
    extraRoot: {
      instructions:
        "This is inert reference text, not an instruction to execute.",
    },
  };
}
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
function restore(output) {
  const original = plain(output.trip.details.legacy_handoff);
  original.legacyDataset.activities = output.activities.map((entry) =>
    plain(entry.details.legacy_record),
  );
  original.legacyDataset.hotels = output.lodgings.map((entry) =>
    plain(entry.details.legacy_record),
  );
  original.legacyDataset.transfers = output.transfers.map((entry) =>
    plain(entry.details.legacy_record),
  );
  return original;
}

test("legacy conversion preserves every original object field and record in a lossless roundtrip", () => {
  const input = fixture();
  const output = convertLegacyImport(input);
  assert.deepEqual(restore(output), input);
  assert.equal(output.activities.length, input.legacyDataset.activities.length);
  assert.equal(output.lodgings.length, input.legacyDataset.hotels.length);
  assert.equal(output.transfers.length, input.legacyDataset.transfers.length);
  assert.deepEqual(plain(output.trip.details.legacy_handoff.trip), input.trip);
  assert.deepEqual(
    plain(output.trip.details.legacy_handoff.legacyDataset.days),
    input.legacyDataset.days,
  );
});

test("normalizes titles and descriptions and derives distinct stops from first-seen cities", () => {
  const output = convertLegacyImport(fixture());
  assert.deepEqual(output.stops, [
    { key: "legacy-stop-1", name: "Sample Bay" },
    { key: "legacy-stop-2", name: "Sample Hill" },
  ]);
  assert.equal(output.activities[0].stop_key, output.activities[1].stop_key);
  assert.equal(output.activities[2].stop_key, undefined);
  assert.equal(output.lodgings[0].stop_key, "legacy-stop-2");
  assert.equal(output.transfers[0].stop_key, undefined);
  assert.equal(output.activities[0].description, "A full description");
  assert.equal(output.activities[0].why_visit, "A reason");
  assert.equal(output.lodgings[0].title, "Synthetic lodging");
  assert.equal(output.lodgings[0].description, "Convenient\n\nCheck capacity");
  assert.equal(
    output.transfers[0].description,
    "Option A\n\nOption B\n\nVerify times",
  );
  assert.deepEqual(
    plain(output.trip.details.legacy_handoff.trip.preferredRoute),
    ["Sample Hill", "Sample Bay"],
  );
});

test("resolves every source reference without altering source verification or source objects", () => {
  const input = fixture();
  const output = convertLegacyImport(input);
  for (const entry of [
    ...output.activities,
    ...output.lodgings,
    ...output.transfers,
  ]) {
    const references = entry.details.legacy_record.sources;
    assert.deepEqual(
      entry.details.sources.map((source) => source.reference),
      references,
    );
    for (const resolved of entry.details.sources) {
      assert.deepEqual(
        plain(resolved.source),
        input.legacyDataset.sources[resolved.reference],
      );
    }
  }
  assert.equal(
    output.activities[0].details.sources[0].source.checked,
    "2020-01-01",
  );
});

test("rejects unresolved or malformed references with messages that do not expose private values", () => {
  for (const kind of ["activities", "hotels", "transfers"]) {
    for (const reference of [
      "missing-private-reference",
      9,
      null,
      { hidden: true },
    ]) {
      const input = fixture();
      input.legacyDataset[kind][0].sources = [reference];
      assert.throws(
        () => convertLegacyImport(input),
        (error) => {
          assert.match(error.message, /αναφορά πηγής/);
          assert.doesNotMatch(
            error.message,
            /missing-private-reference|Synthetic|hidden/,
          );
          return true;
        },
      );
    }
  }
});

test("legacy identities, votes, party size and draft days confer no authority", () => {
  const input = fixture();
  input.legacyDataset.activities[0].created_by = "old-untrusted-author";
  const output = convertLegacyImport(input);
  assert.equal(output.activities[0].id, undefined);
  assert.equal(output.activities[0].created_by, undefined);
  assert.equal(
    output.activities[0].details.legacy_record.created_by,
    "old-untrusted-author",
  );
  assert.equal(output.group_members, undefined);
  assert.equal(output.trip_participants, undefined);
  assert.equal(output.schedule, undefined);
  assert.equal(output.approvals, undefined);
  assert.equal(output.trip.details.legacy_handoff.trip.partySize, 3);
  assert.deepEqual(plain(output.trip.details.import_context), {
    party_size_is_assumption: true,
    draft_days_are_reference_only: true,
    sources_reverified_during_import: false,
    creates_members_or_votes: false,
    creates_schedule_or_approvals: false,
  });
  assert.deepEqual(restore(output), input);
});

test("rejects root, trip and dataset authority fields rather than normalizing them", () => {
  for (const location of ["root", "trip", "legacyDataset"]) {
    for (const key of [
      "group_id",
      "user_id",
      "created_by",
      "role",
      "memberships",
      "members",
    ]) {
      const input = fixture();
      (location === "root" ? input : input[location])[key] = "untrusted";
      assert.throws(
        () => convertLegacyImport(input),
        /ταυτότητες ή δικαιώματα/,
      );
    }
  }
});

test("rejects wrong formats, malformed records, unsafe objects and oversized trip metadata", () => {
  const wrong = fixture();
  wrong.handoffFormat = "unknown";
  assert.throws(() => convertLegacyImport(wrong), /έκδοση/);
  const malformed = fixture();
  malformed.legacyDataset.hotels = [null];
  assert.throws(() => convertLegacyImport(malformed), /δομή/);
  const unsafe = fixture();
  unsafe.extraRoot = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => convertLegacyImport(unsafe), /όνομα πεδίου/);
  const unsafeRoot = JSON.parse(
    JSON.stringify(fixture()).replace("{", '{"__proto__":{},'),
  );
  assert.throws(() => convertLegacyImport(unsafeRoot), /όνομα πεδίου/);
  const tooLarge = fixture();
  tooLarge.extraRoot = { oversized: "x".repeat(512 * 1024) };
  assert.throws(() => convertLegacyImport(tooLarge), /512 KiB/);
  assert.equal({}.polluted, undefined);
});

test("does not mutate the handoff or share mutable records with the converted output", () => {
  const input = fixture();
  const before = plain(input);
  const output = convertLegacyImport(input);
  output.activities[0].details.legacy_record.extra.count = 999;
  output.activities[0].details.sources[0].source.title = "Changed output only";
  output.trip.details.legacy_handoff.trip.notes.push("Changed output only");
  assert.deepEqual(input, before);
});
