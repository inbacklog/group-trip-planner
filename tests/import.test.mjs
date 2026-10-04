import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePrivateImport,
  getImportSummary,
  safeExternalUrl,
  MAX_IMPORT_BYTES,
} from "../src/lib/privateImport.ts";

function fixture() {
  return {
    schema_version: 1,
    kind: "private-trip",
    trip: {
      name: "Synthetic trip",
      currency: "EUR",
      timezone: "Asia/Shanghai",
    },
    stops: [{ key: "stop-a", name: "Synthetic city" }],
    activities: [
      {
        title: "Synthetic idea",
        stop_key: "stop-a",
        description: "Long description preserved",
        why_visit: "A reason",
        details: {
          sources: [
            { url: "https://example.com/source", last_verified: "2020-01-01" },
          ],
          cost: { amount: null, status: "unknown", unit: "per_person" },
          local_name: "合成测试",
        },
      },
    ],
    lodgings: [
      {
        title: "Synthetic lodging",
        details: { room_type: "unknown", capacity: null },
      },
    ],
    transfers: [],
  };
}
test("private import preserves descriptions, unknown costs and source verification dates", () => {
  const input = fixture();
  const output = parsePrivateImport(JSON.stringify(input));
  assert.equal(
    output.activities[0].description,
    input.activities[0].description,
  );
  assert.equal(
    output.activities[0].details.sources[0].last_verified,
    "2020-01-01",
  );
  assert.equal(output.activities[0].details.cost.amount, null);
  assert.equal(output.activities[0].details.local_name, "合成测试");
  assert.deepEqual(getImportSummary(output), {
    name: "Synthetic trip",
    stops: 1,
    activities: 1,
    lodgings: 1,
    transfers: 0,
  });
});
test("rejects imported tenant IDs, user IDs, roles and incompatible legacy formats", () => {
  for (const key of ["group_id", "user_id", "role", "created_by"]) {
    assert.throws(() =>
      parsePrivateImport(JSON.stringify({ ...fixture(), [key]: "foreign" })),
    );
    const input = fixture();
    input.activities[0][key] = "foreign";
    assert.throws(() => parsePrivateImport(JSON.stringify(input)));
  }
  assert.throws(() => parsePrivateImport('{"data":[]}'), /μη υποστηριζόμενα/);
  assert.throws(
    () =>
      parsePrivateImport(JSON.stringify({ ...fixture(), schema_version: 2 })),
    /v1/,
  );
});
test("rejects missing and duplicate stop references", () => {
  const input = fixture();
  input.activities[0].stop_key = "missing";
  assert.throws(() => parsePrivateImport(JSON.stringify(input)), /δεν υπάρχει/);
  const duplicated = fixture();
  duplicated.stops.push({ ...duplicated.stops[0] });
  assert.throws(
    () => parsePrivateImport(JSON.stringify(duplicated)),
    /μοναδικό/,
  );
});
test("links exclude script, data, credentials and relative protocols", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,<script>",
    "//example.com",
    "https://user:pass@example.com",
  ]) {
    assert.equal(safeExternalUrl(value), null);
    const input = fixture();
    input.activities[0].details.sources[0].url = value;
    assert.throws(() => parsePrivateImport(JSON.stringify(input)), /σύνδεσμοι/);
  }
  assert.equal(
    safeExternalUrl("https://example.com/path"),
    "https://example.com/path",
  );
});
test("validates JSON, byte size, prototype keys and metadata depth", () => {
  assert.throws(() => parsePrivateImport("{bad"), /JSON/);
  assert.throws(
    () => parsePrivateImport(" ".repeat(MAX_IMPORT_BYTES + 1)),
    /2 MB/,
  );
  const input = fixture();
  input.activities[0].details = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(
    () => parsePrivateImport(JSON.stringify(input)),
    /όνομα πεδίου/,
  );
  let nested = {};
  let cursor = nested;
  for (let i = 0; i < 15; i++) {
    cursor.next = {};
    cursor = cursor.next;
  }
  input.activities[0].details = nested;
  assert.throws(() => parsePrivateImport(JSON.stringify(input)), /επίπεδα/);
  assert.equal({}.polluted, undefined);
});
test("accepts a deliberately blank trip and BOM; validates currency and timezone", () => {
  const input = {
    schema_version: 1,
    kind: "private-trip",
    trip: { name: "Blank" },
    stops: [],
    activities: [],
    lodgings: [],
    transfers: [],
  };
  assert.equal(
    parsePrivateImport("\uFEFF" + JSON.stringify(input)).trip.currency,
    "EUR",
  );
  assert.equal(parsePrivateImport(JSON.stringify(input)).stops.length, 0);
  assert.throws(() =>
    parsePrivateImport(
      JSON.stringify({ ...input, trip: { name: "X", currency: "euro" } }),
    ),
  );
  assert.throws(() =>
    parsePrivateImport(
      JSON.stringify({
        ...input,
        trip: { name: "X", timezone: "not-a-timezone" },
      }),
    ),
  );
});
