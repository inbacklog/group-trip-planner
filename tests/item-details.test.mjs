import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getItemPresentation,
  saveItemPresentation,
  getItemSources,
  safeImageUrl,
} from "../src/lib/itemDetails.ts";

test("unknown imported kinds remain editable and record prices retain their own currency", () => {
  const original = {
    presentation: { kind: "hotel" },
    legacy_record: { costMin: 10, costMax: 20, currency: "USD" },
  };
  const result = getItemPresentation(original, "EUR");
  assert.equal(result.kind, "activity");
  assert.equal(result.estimated_cost, "10–20 USD");
  assert.doesNotThrow(() => saveItemPresentation(original, result));
});

test("legacy duration is not confused with opening hours and uncertain zero cost is preserved", () => {
  const result = getItemPresentation(
    {
      legacy_record: {
        hours: 2.5,
        costMin: 0,
        costMax: 0,
        costNote: "Unknown price",
        costStatus: "estimate",
        closedDays: ["Monday"],
        closureNote: "Check holidays",
      },
    },
    "EUR",
  );
  assert.equal(result.duration, "2.5 ώρες");
  assert.match(result.hours, /Monday.*Check holidays/);
  assert.ok(!result.hours.includes("2.5"));
  assert.equal(result.estimated_cost, "0–0 EUR · Unknown price · estimate");
  assert.equal(
    getItemPresentation({ legacy_record: { closedDays: [] } }).hours,
    "",
  );
});

test("rich edits and explicit clears preserve the original and unknown metadata", () => {
  const original = {
    legacy_record: { city: "Synthetic place", hours: 1 },
    sources: [{ url: "https://example.test/source" }],
    extra: { keep: true },
    presentation: { future_field: "keep" },
  };
  const values = getItemPresentation(original);
  const saved = saveItemPresentation(original, {
    ...values,
    kind: "place",
    location: "",
    website_url: "https://example.test/info",
  });
  assert.equal(getItemPresentation(saved).location, "");
  assert.equal(getItemPresentation(saved).kind, "place");
  assert.deepEqual(saved.legacy_record, original.legacy_record);
  assert.deepEqual(saved.sources, original.sources);
  assert.deepEqual(saved.extra, original.extra);
  assert.equal(saved.presentation.future_field, "keep");
  assert.ok(!Object.hasOwn(original.presentation, "location"));
});

test("unsafe links cannot be saved or rendered as source/image URLs", () => {
  const values = getItemPresentation();
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:password@example.test/",
    "/relative",
  ]) {
    assert.throws(() =>
      saveItemPresentation({}, { ...values, website_url: url }),
    );
    assert.deepEqual(
      getItemSources({ sources: [{ title: "Synthetic", url }] }),
      [],
    );
    assert.equal(safeImageUrl(url), null);
  }
  assert.throws(() =>
    saveItemPresentation(
      {},
      { ...values, image_url: "http://example.test/photo.jpg" },
    ),
  );
  assert.equal(
    safeImageUrl("https://example.test/photo.jpg"),
    "https://example.test/photo.jpg",
  );
  assert.deepEqual(
    getItemSources({
      sources: [
        {
          reference: "a",
          source: {
            title: "Synthetic source",
            url: "https://example.test/",
            checked: "2025-01-01",
          },
        },
      ],
    }),
    [
      {
        title: "Synthetic source",
        url: "https://example.test/",
        checked: "2025-01-01",
      },
    ],
  );
});
