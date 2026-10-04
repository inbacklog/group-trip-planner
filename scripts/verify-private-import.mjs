/** Local, in-memory verification. Never connects to a hosted Supabase project. */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import {
  parsePrivateImport,
  getImportSummary,
} from "../src/lib/privateImport.ts";

const [input, output] = process.argv.slice(2);
if (!input)
  throw new Error(
    "Usage: node scripts/verify-private-import.mjs PRIVATE_INPUT.json [PRIVATE_OUTPUT.json]",
  );
const original = JSON.parse(
  (await readFile(input, "utf8")).replace(/^\uFEFF/, ""),
);
const payload = parsePrivateImport(JSON.stringify(original));
if (original.handoffFormat === "project-china-private-handoff-v1") {
  const legacy = payload.trip.details.legacy_handoff;
  const reconstructed = {
    ...legacy,
    legacyDataset: {
      ...legacy.legacyDataset,
      activities: payload.activities.map((x) => x.details.legacy_record),
      hotels: payload.lodgings.map((x) => x.details.legacy_record),
      transfers: payload.transfers.map((x) => x.details.legacy_record),
    },
  };
  // JSON normalization removes only null-prototype objects introduced by validation.
  assert.ok(
    isDeepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original),
    "Conversion must preserve every original field",
  );
}
const db = new PGlite();
try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/INSTALL_ALL.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const owner = randomUUID(),
    outsider = randomUUID();
  await db.query("insert into auth.users(id) values($1),($2)", [
    owner,
    outsider,
  ]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  const groupId = (
    await db.query("select public.create_group($1,$2) as id", [
      "Private local verification",
      randomUUID(),
    ])
  ).rows[0].id;
  const requestId = randomUUID();
  const tripId = (
    await db.query("select public.import_private_trip($1,$2,$3) as id", [
      groupId,
      payload,
      requestId,
    ])
  ).rows[0].id;
  const retryId = (
    await db.query("select public.import_private_trip($1,$2,$3) as id", [
      groupId,
      payload,
      requestId,
    ])
  ).rows[0].id;
  assert.equal(tripId, retryId);
  for (const [table, items] of [
    ["trip_stops", payload.stops],
    ["activities", payload.activities],
    ["lodgings", payload.lodgings],
    ["transfers", payload.transfers],
  ]) {
    const rows = (
      await db.query(`select * from public.${table} where trip_id=$1`, [tripId])
    ).rows;
    assert.equal(rows.length, items.length, table);
    if (table !== "trip_stops") {
      for (const item of items) {
        const row = rows.find(
          (candidate) =>
            candidate.details.legacy_record?.id ===
              item.details.legacy_record?.id && candidate.title === item.title,
        );
        assert.ok(row, "Imported item must exist");
        assert.deepEqual(row.details, JSON.parse(JSON.stringify(item.details)));
        assert.equal(row.description, item.description ?? "");
      }
    }
  }
  const actualTrip = (
    await db.query("select details from public.trips where id=$1", [tripId])
  ).rows[0];
  assert.deepEqual(
    actualTrip.details,
    JSON.parse(JSON.stringify(payload.trip.details)),
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    outsider,
  ]);
  for (const table of [
    "trips",
    "trip_stops",
    "activities",
    "lodgings",
    "transfers",
  ]) {
    assert.equal(
      (await db.query(`select count(*)::int as count from public.${table}`))
        .rows[0].count,
      0,
    );
  }
  if (output)
    await writeFile(output, JSON.stringify(payload, null, 2) + "\n", {
      flag: "wx",
    });
  const { name: _privateName, ...counts } = getImportSummary(payload);
  console.log(
    JSON.stringify({
      result: "PASS",
      counts,
      sources: Object.keys(original.legacyDataset?.sources ?? {}).length,
      draftDays: original.legacyDataset?.days?.length ?? 0,
      losslessConversion: true,
      localDatabaseImport: true,
      hostedWrites: false,
    }),
  );
} catch (error) {
  // Database errors can carry query payloads: do not dump real trip content.
  console.error(
    `Private verification failed: ${error.code ?? error.name}. Check locally; no private payload printed.`,
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
