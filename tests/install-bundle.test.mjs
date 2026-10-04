import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { buildInstallSql } from "../scripts/build-install-sql.mjs";

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated;`);
  return db;
}

test("single install artifact matches migrations and installs the complete app atomically", async () => {
  const generated = await buildInstallSql();
  assert.equal(
    (
      await readFile(
        new URL("../supabase/INSTALL_ALL.sql", import.meta.url),
        "utf8",
      )
    ).replaceAll("\r\n", "\n"),
    generated,
  );
  const db = await database();
  try {
    await db.exec(generated);
    const tables = (
      await db.query(
        "select tablename from pg_tables where schemaname='public' order by tablename",
      )
    ).rows.map((r) => r.tablename);
    for (const table of [
      "groups",
      "activity_comments",
      "activity_preferences",
      "itinerary_days",
      "itinerary_items",
      "plan_approvals",
    ])
      assert.ok(tables.includes(table));
    assert.ok(
      (
        await db.query(
          "select to_regprocedure('public.get_plan_snapshot(uuid)') is not null as installed",
        )
      ).rows[0].installed,
    );
    await assert.rejects(
      () => db.exec(generated),
      /Existing Group Trip Planner schema detected/,
    );
    await db.exec("rollback;");
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from pg_tables where schemaname='public'",
        )
      ).rows[0].n,
      tables.length,
    );
  } finally {
    await db.close();
  }
});

test("install collision leaves pre-existing records untouched and creates no partial schema", async () => {
  const db = await database();
  try {
    await db.exec(
      "create table public.itinerary_days(note text); insert into public.itinerary_days values('synthetic-existing-record');",
    );
    const sql = await buildInstallSql();
    await assert.rejects(
      () => db.exec(sql),
      /Existing Group Trip Planner schema detected/,
    );
    await db.exec("rollback;");
    assert.equal(
      (await db.query("select note from public.itinerary_days")).rows[0].note,
      "synthetic-existing-record",
    );
    assert.equal(
      (await db.query("select to_regclass('public.groups') as relation"))
        .rows[0].relation,
      null,
    );
  } finally {
    await db.close();
  }
});
