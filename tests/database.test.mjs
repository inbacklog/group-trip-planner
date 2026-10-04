import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

// These assertions run PostgreSQL grants/RLS as unprivileged database roles.
// PGlite is not Supabase Auth/PostgREST, Realtime, or a concurrent HTTP server.
let db;
const users = Object.fromEntries(
  ["a1", "a2", "a3", "b1", "b2", "new"].map((k) => [k, randomUUID()]),
);
let groupA, groupB, tripA, tripB;

async function query(sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function scalar(sql, params = []) {
  return Object.values((await query(sql, params))[0])[0];
}
async function as(user, work) {
  await db.exec(user === null ? "set role anon" : "set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    user ?? "",
  ]);
  try {
    return await work();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
async function rpc(name, params) {
  return scalar(
    `select public.${name}(${params.map((_, i) => `$${i + 1}`).join(",")})`,
    params,
  );
}
async function denied(work, codes = ["42501", "23503", "22023"]) {
  await assert.rejects(
    work,
    (error) => codes.includes(error.code),
    `Expected permission, constraint, or validation rejection (${codes.join(", ")})`,
  );
}
const payload = () => ({
  schema_version: 1,
  kind: "private-trip",
  trip: {
    name: "Synthetic private itinerary",
    currency: "EUR",
    timezone: "Asia/Shanghai",
    details: {
      anchors: [
        {
          key: "synthetic-arrival",
          local_date: "2040-01-05",
          local_time: "00:30",
          timezone: "UTC",
          booking_status: "unknown",
        },
      ],
      draftDays: [
        {
          day: 1,
          items: ["synthetic-idea"],
          alternatives: ["Synthetic indoor option"],
        },
      ],
      provenance: {
        kind: "synthetic-fixture",
        source_verified_at: "2020-01-01",
      },
      notes: ["Keep this context privately"],
      legacy_members: [{ user_id: users.new, role: "owner" }],
      legacy_votes: [{ user_id: users.new, value: "must" }],
    },
  },
  stops: [{ key: "synthetic-a", name: "Synthetic place" }],
  activities: [
    {
      title: "Synthetic museum",
      stop_key: "synthetic-a",
      description: "Long original description retained",
      why_visit: "A useful alternative",
      details: {
        sources: [
          { url: "https://example.com/reference", last_verified: "2020-01-01" },
        ],
        costs: { amount: null, status: "unknown" },
        nested: { note: "<script>inert data</script>" },
      },
    },
  ],
  lodgings: [
    {
      title: "Synthetic lodging",
      stop_key: "synthetic-a",
      details: { unit: "per_room_per_night", estimate: 30 },
    },
  ],
  transfers: [
    {
      title: "Synthetic transfer",
      description: "No assumed booking",
      details: { status: "estimate" },
    },
  ],
});

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    -- Supabase projects may start with broad table defaults. The migration
    -- must explicitly remove them before granting only its intended columns.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202610040001_private_groups.sql",
      import.meta.url,
    ),
    "utf8",
  );
  try {
    await db.exec(migration);
  } catch (error) {
    throw new Error(
      `Migration ${error.code}: ${error.message}; position ${error.position}; context ${migration.slice(Math.max(0, Number(error.position) - 100), Number(error.position) + 100)}`,
    );
  }
  for (const id of Object.values(users))
    await db.query("insert into auth.users(id) values($1)", [id]);
  groupA = await as(users.a1, () =>
    rpc("create_group", ["Synthetic group A", randomUUID()]),
  );
  groupB = await as(users.b1, () =>
    rpc("create_group", ["Synthetic group B", randomUUID()]),
  );
  tripA = await as(users.a1, () =>
    rpc("create_trip", [groupA, "Private A", "blank", randomUUID()]),
  );
  tripB = await as(users.b1, () =>
    rpc("create_trip", [groupB, "Private B", "china", randomUUID()]),
  );
  const token = await as(users.a1, () => rpc("create_invitation", [groupA]));
  await as(users.a2, () => rpc("accept_invitation", [token]));
});
after(async () => {
  if (db) await db.close();
});

test("ONB-01/03/10: new users have no groups or trip data; blank trip has no defaults", async () => {
  await as(users.new, async () => {
    for (const table of [
      "groups",
      "group_members",
      "trips",
      "trip_stops",
      "activities",
      "lodgings",
      "transfers",
      "trip_participants",
    ]) {
      assert.equal(
        await scalar(`select count(*)::int from public.${table}`),
        0,
        table,
      );
    }
  });
  await as(users.a1, async () => {
    assert.equal(
      await scalar(
        "select count(*)::int from public.trip_stops where trip_id=$1",
        [tripA],
      ),
      0,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.activities where trip_id=$1",
        [tripA],
      ),
      0,
    );
    assert.deepEqual(
      await scalar("select details from public.trips where id=$1", [tripA]),
      {},
    );
  });
  await as(users.b1, async () =>
    assert.deepEqual(
      await scalar("select details from public.trips where id=$1", [tripB]),
      {},
    ),
  );
});

test("ONB-02/05/06/07: exact independent two-stop template, idempotent creates, no reseed", async () => {
  await as(users.a1, async () => {
    const groupRequest = randomUUID();
    const group = await rpc("create_group", ["Retry group", groupRequest]);
    assert.equal(
      await rpc("create_group", ["Retry group", groupRequest]),
      group,
    );
    await denied(() => rpc("create_group", ["Changed group", groupRequest]));
    const request = randomUUID();
    const first = await rpc("create_trip", [
      groupA,
      "Starter one",
      "china",
      request,
    ]);
    const second = await rpc("create_trip", [
      groupA,
      "Starter two",
      "china",
      randomUUID(),
    ]);
    assert.equal(
      await rpc("create_trip", [groupA, "Starter one", "china", request]),
      first,
    );
    await denied(() =>
      rpc("create_trip", [groupA, "Changed title", "china", request]),
    );
    const stops = await query(
      "select id,name from public.trip_stops where trip_id=$1 order by position",
      [first],
    );
    const other = await query(
      "select id,name from public.trip_stops where trip_id=$1 order by position",
      [second],
    );
    assert.deepEqual(
      stops.map((s) => s.name),
      ["Σαγκάη", "Πεκίνο"],
    );
    assert.deepEqual(
      other.map((s) => s.name),
      ["Σαγκάη", "Πεκίνο"],
    );
    assert.ok(stops.every((s) => other.every((o) => o.id !== s.id)));
    for (const table of ["activities", "lodgings", "transfers"])
      assert.equal(
        await scalar(
          `select count(*)::int from public.${table} where trip_id=$1`,
          [first],
        ),
        0,
      );
    await db.query("delete from public.trip_stops where id=$1", [stops[0].id]);
    await rpc("create_trip", [groupA, "Starter one", "china", request]);
    assert.equal(
      await scalar(
        "select count(*)::int from public.trip_stops where trip_id=$1",
        [first],
      ),
      1,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.trip_stops where trip_id=$1",
        [second],
      ),
      2,
    );
  });
});

test("RLS: anonymous and unrelated users cannot read private tables or call RPCs", async () => {
  await as(null, async () => {
    for (const table of [
      "groups",
      "group_members",
      "trips",
      "trip_stops",
      "activities",
      "lodgings",
      "transfers",
      "trip_participants",
      "group_invitations",
    ])
      await denied(() => query(`select * from public.${table}`));
    await denied(() => rpc("create_group", ["Anon group", randomUUID()]));
    await denied(() => rpc("accept_invitation", ["a".repeat(64)]));
  });
  await as(users.b1, async () => {
    assert.equal(
      await scalar("select count(*)::int from public.groups where id=$1", [
        groupA,
      ]),
      0,
    );
    assert.equal(
      await scalar("select count(*)::int from public.trips where id=$1", [
        tripA,
      ]),
      0,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.trip_stops where trip_id=$1",
        [tripA],
      ),
      0,
    );
    await denied(() =>
      rpc("create_trip", [groupA, "Forged trip", "china", randomUUID()]),
    );
    await denied(() => rpc("create_invitation", [groupA]));
    await denied(() => rpc("set_participation", [tripA, "going"]));
    await denied(() =>
      rpc("import_private_trip", [
        groupA,
        JSON.stringify(payload()),
        randomUUID(),
      ]),
    );
  });
});

test("ONB-08: failure during starter stop copy rolls back the entire trip and retry succeeds", async () => {
  // A fixture-only trigger fails on the second stop, after the first insert.
  await db.exec(`
    create function public.synthetic_stop_failure() returns trigger language plpgsql as $$
    begin if new.name='Πεκίνο' then raise exception 'Synthetic second-stop failure'; end if; return new; end $$;
    create trigger synthetic_stop_failure before insert on public.trip_stops for each row execute function public.synthetic_stop_failure();
  `);
  const request = randomUUID();
  try {
    await as(users.a1, async () => {
      const before = await scalar(
        "select count(*)::int from public.trips where group_id=$1",
        [groupA],
      );
      await denied(
        () => rpc("create_trip", [groupA, "Atomic starter", "china", request]),
        ["P0001"],
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.trips where group_id=$1",
          [groupA],
        ),
        before,
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.trips where name='Atomic starter'",
        ),
        0,
      );
    });
  } finally {
    await db.exec(
      "drop trigger synthetic_stop_failure on public.trip_stops; drop function public.synthetic_stop_failure()",
    );
  }
  await as(users.a1, async () => {
    const trip = await rpc("create_trip", [
      groupA,
      "Atomic starter",
      "china",
      request,
    ]);
    assert.equal(
      await scalar(
        "select count(*)::int from public.trip_stops where trip_id=$1",
        [trip],
      ),
      2,
    );
  });
});

test("RLS: membership, author IDs, parent IDs and role escalation cannot be forged", async () => {
  await as(users.a2, async () => {
    await denied(() =>
      db.query(
        "insert into public.group_members(group_id,user_id,role) values($1,$2,'owner')",
        [groupB, users.a2],
      ),
    );
    await denied(() =>
      db.query(
        "update public.group_members set role='owner' where group_id=$1 and user_id=$2",
        [groupA, users.a2],
      ),
    );
    await denied(() =>
      db.query(
        "insert into public.activities(trip_id,title,created_by) values($1,$2,$3)",
        [tripA, "Forged author", users.a1],
      ),
    );
    const own = await scalar(
      "insert into public.activities(trip_id,title) values($1,$2) returning id",
      [tripA, "Own activity"],
    );
    assert.equal(
      await scalar("select created_by from public.activities where id=$1", [
        own,
      ]),
      users.a2,
    );
    await denied(() =>
      db.query("update public.activities set trip_id=$1 where id=$2", [
        tripB,
        own,
      ]),
    );
    await denied(() =>
      db.query("update public.activities set created_by=$1 where id=$2", [
        users.a1,
        own,
      ]),
    );
    await denied(() =>
      db.query("update public.activities set version=900 where id=$1", [own]),
    );
    await denied(() =>
      rpc("create_trip", [
        groupA,
        "Member cannot create trip",
        "blank",
        randomUUID(),
      ]),
    );
    await denied(() => rpc("remove_member", [groupA, users.a1]));
  });
});

test("Stop/item creation RPCs are idempotent, validate fields and recheck authorization on retry", async () => {
  let stop;
  await as(users.a1, async () => {
    const request = randomUUID();
    stop = await rpc("create_stop", [
      tripA,
      "Synthetic retry stop",
      100,
      request,
    ]);
    assert.equal(
      await rpc("create_stop", [tripA, "Synthetic retry stop", 100, request]),
      stop,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.trip_stops where trip_id=$1 and name='Synthetic retry stop'",
        [tripA],
      ),
      1,
    );
    await denied(() =>
      rpc("create_stop", [tripA, "Changed stop", 100, request]),
    );
    await denied(() =>
      rpc("create_stop", [tripB, "Foreign stop", 100, randomUUID()]),
    );
    for (const table of ["activities", "lodgings", "transfers"]) {
      const itemRequest = randomUUID();
      const fields = {
        title: `Synthetic retry ${table}`,
        stop_id: stop,
        description: "Preserved draft",
        details: { note: "Synthetic source context" },
      };
      if (table === "activities") fields.why_visit = "Synthetic reason";
      const id = await rpc("create_item", [
        table,
        tripA,
        JSON.stringify(fields),
        itemRequest,
      ]);
      assert.equal(
        await rpc("create_item", [
          table,
          tripA,
          JSON.stringify(fields),
          itemRequest,
        ]),
        id,
      );
      assert.equal(
        await scalar(
          `select count(*)::int from public.${table} where trip_id=$1 and title=$2`,
          [tripA, fields.title],
        ),
        1,
      );
      assert.equal(
        await scalar(`select created_by from public.${table} where id=$1`, [
          id,
        ]),
        users.a1,
      );
      await denied(() =>
        rpc("create_item", [
          table,
          tripA,
          JSON.stringify({ ...fields, title: "Changed item" }),
          itemRequest,
        ]),
      );
      await denied(() =>
        rpc("create_item", [
          table,
          tripB,
          JSON.stringify(fields),
          randomUUID(),
        ]),
      );
    }
    for (const fields of [
      { title: "Forged", created_by: users.b1 },
      { title: "Forged", trip_id: tripB },
      { title: "Forged", id: randomUUID() },
      { title: "Forged", role: "owner" },
      { title: "Wrong details", details: [] },
      { title: "Wrong details", details: { huge: "x".repeat(102400) } },
    ])
      await denied(() =>
        rpc("create_item", [
          "activities",
          tripA,
          JSON.stringify(fields),
          randomUUID(),
        ]),
      );
    await denied(() =>
      rpc("create_item", [
        "groups",
        tripA,
        JSON.stringify({ title: "Bad table" }),
        randomUUID(),
      ]),
    );
    await denied(() =>
      rpc("create_item", [
        "lodgings",
        tripA,
        JSON.stringify({ title: "Wrong field", why_visit: "Not permitted" }),
        randomUUID(),
      ]),
    );
  });
  await as(users.a2, async () => {
    await denied(() =>
      rpc("create_stop", [tripA, "Member stop", 101, randomUUID()]),
    );
    await denied(() =>
      rpc("create_item", [
        "lodgings",
        tripA,
        JSON.stringify({ title: "Member lodging" }),
        randomUUID(),
      ]),
    );
    const id = await rpc("create_item", [
      "activities",
      tripA,
      JSON.stringify({ title: "Member RPC idea", stop_id: stop }),
      randomUUID(),
    ]);
    assert.equal(
      await scalar("select created_by from public.activities where id=$1", [
        id,
      ]),
      users.a2,
    );
  });
  const foreignStop = await as(users.b1, () =>
    scalar(
      "select id from public.trip_stops where trip_id=$1 order by position limit 1",
      [tripB],
    ),
  );
  await as(users.a1, () =>
    denied(() =>
      rpc("create_item", [
        "activities",
        tripA,
        JSON.stringify({ title: "Wrong parent", stop_id: foreignStop }),
        randomUUID(),
      ]),
    ),
  );

  // The privileged setup assigns a test admin; all assertions use normal roles.
  const group = await as(users.b1, () =>
    rpc("create_group", ["Synthetic retry authorization", randomUUID()]),
  );
  const trip = await as(users.b1, () =>
    rpc("create_trip", [group, "Synthetic retry trip", "blank", randomUUID()]),
  );
  const token = await as(users.b1, () => rpc("create_invitation", [group]));
  await as(users.b2, () => rpc("accept_invitation", [token]));
  await db.query(
    "update public.group_members set role='admin' where group_id=$1 and user_id=$2",
    [group, users.b2],
  );
  const stopRequest = randomUUID();
  const itemRequest = randomUUID();
  const fields = JSON.stringify({ title: "Former member item" });
  await as(users.b2, async () => {
    await rpc("create_stop", [trip, "Former admin stop", 0, stopRequest]);
    await rpc("create_item", ["activities", trip, fields, itemRequest]);
  });
  await as(users.b1, () => rpc("remove_member", [group, users.b2]));
  await as(users.b2, async () => {
    await denied(() =>
      rpc("create_stop", [trip, "Former admin stop", 0, stopRequest]),
    );
    await denied(() =>
      rpc("create_item", ["activities", trip, fields, itemRequest]),
    );
  });
  await as(null, async () => {
    await denied(() =>
      rpc("create_stop", [tripA, "Anonymous stop", 0, randomUUID()]),
    );
    await denied(() =>
      rpc("create_item", ["activities", tripA, fields, randomUUID()]),
    );
  });
});

test("RLS: all private content tables enforce cross-group writes and hidden joins", async () => {
  const foreignStop = await as(users.b1, () =>
    scalar(
      "select id from public.trip_stops where trip_id=$1 order by position limit 1",
      [tripB],
    ),
  );
  const foreignRows = await as(users.b1, async () => {
    const ids = {};
    for (const table of ["activities", "lodgings", "transfers"])
      ids[table] = await scalar(
        `insert into public.${table}(trip_id,title) values($1,'Group B synthetic content') returning id`,
        [tripB],
      );
    return ids;
  });
  await as(users.a1, async () => {
    for (const table of ["activities", "lodgings", "transfers"]) {
      await denied(() =>
        db.query(
          `insert into public.${table}(trip_id,title) values($1,'Foreign write')`,
          [tripB],
        ),
      );
      await denied(() =>
        db.query(
          `insert into public.${table}(trip_id,stop_id,title) values($1,$2,'Cross-trip reference')`,
          [tripA, foreignStop],
        ),
      );
      assert.equal(
        (
          await query(`select * from public.${table} where id=$1`, [
            foreignRows[table],
          ])
        ).length,
        0,
      );
      assert.equal(
        (
          await query(
            `update public.${table} set title='Foreign overwrite' where id=$1 returning id`,
            [foreignRows[table]],
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await query(`delete from public.${table} where id=$1 returning id`, [
            foreignRows[table],
          ])
        ).length,
        0,
      );
    }
    await denied(() =>
      db.query(
        "insert into public.trip_stops(trip_id,name) values($1,'Foreign stop')",
        [tripB],
      ),
    );
    assert.equal(
      (
        await query(
          "update public.trip_stops set name='Foreign overwrite' where id=$1 returning id",
          [foreignStop],
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await query("delete from public.trip_stops where id=$1 returning id", [
          foreignStop,
        ])
      ).length,
      0,
    );
    assert.equal(
      (
        await query(
          "select a.id,t.name from public.activities a join public.trips t on t.id=a.trip_id where t.id=$1",
          [tripB],
        )
      ).length,
      0,
    );
    await denied(() =>
      db.query("update public.trips set group_id=$1 where id=$2", [
        groupB,
        tripA,
      ]),
    );
    await denied(() =>
      db.query("update public.trips set timezone=$1 where id=$2", [
        "Fake/Timezone",
        tripA,
      ]),
    );
  });
});

test("Content ownership and optimistic versions reject lost updates", async () => {
  const activity = await as(users.a1, () =>
    scalar(
      "insert into public.activities(trip_id,title) values($1,'Owner proposal') returning id",
      [tripA],
    ),
  );
  await as(users.a2, async () => {
    assert.equal(
      (
        await query(
          "update public.activities set title='Unauthorized edit' where id=$1 returning id",
          [activity],
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await query("delete from public.activities where id=$1 returning id", [
          activity,
        ])
      ).length,
      0,
    );
  });
  await as(users.a1, async () => {
    const result = await query(
      "update public.activities set title='Updated' where id=$1 and version=1 returning version",
      [activity],
    );
    assert.equal(result[0].version, 2);
    assert.equal(
      (
        await query(
          "update public.activities set title='Stale overwrite' where id=$1 and version=1 returning id",
          [activity],
        )
      ).length,
      0,
    );
    assert.equal(
      await scalar("select title from public.activities where id=$1", [
        activity,
      ]),
      "Updated",
    );
  });
});

test("Atomic stop reorder rejects foreign/missing/duplicate IDs and stale versions", async () => {
  await as(users.a1, async () => {
    const trip = await rpc("create_trip", [
      groupA,
      "Order trip",
      "china",
      randomUUID(),
    ]);
    const stops = await query(
      "select id from public.trip_stops where trip_id=$1 order by position",
      [trip],
    );
    const ids = stops.map((s) => s.id);
    const version = await scalar(
      "select version from public.trips where id=$1",
      [trip],
    );
    await denied(() => rpc("reorder_stops", [trip, [ids[0]], version]));
    await denied(() => rpc("reorder_stops", [trip, [ids[0], ids[0]], version]));
    await denied(() =>
      rpc("reorder_stops", [trip, [ids[0], randomUUID()], version]),
    );
    const next = await rpc("reorder_stops", [
      trip,
      [...ids].reverse(),
      version,
    ]);
    assert.ok(next > version);
    assert.deepEqual(
      (
        await query(
          "select id from public.trip_stops where trip_id=$1 order by position",
          [trip],
        )
      ).map((s) => s.id),
      [...ids].reverse(),
    );
    await denied(() => rpc("reorder_stops", [trip, ids, version]), ["40001"]);
  });
});

test("INV-01/03/04/05: hashed one-use invitation joins only as member without seeding", async () => {
  const token = await as(users.a1, () => rpc("create_invitation", [groupA]));
  assert.match(token, /^[0-9a-f]{64}$/);
  const stored = await scalar(
    "select token_hash from public.group_invitations where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
    [token],
  );
  assert.notEqual(stored, token);
  await as(users.a1, () =>
    denied(() => query("select token_hash from public.group_invitations")),
  );
  await as(users.a3, async () => {
    assert.equal(
      (await query("select id,group_id from public.group_invitations")).length,
      0,
    );
    assert.equal(await rpc("accept_invitation", [token]), groupA);
    assert.equal(
      await scalar(
        "select role from public.group_members where group_id=$1 and user_id=$2",
        [groupA, users.a3],
      ),
      "member",
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.trips where created_by=$1",
        [users.a3],
      ),
      0,
    );
    await denied(() => rpc("accept_invitation", [token]));
    await denied(() => rpc("create_invitation", [groupA]));
  });
  await as(users.new, () => denied(() => rpc("accept_invitation", [token])));
});

test("Member place suggestions preserve rich presentation without a route stop and enforce authorship", async () => {
  const details = {
    presentation: {
      kind: "place",
      location: "Synthetic riverside district",
      category: "Viewpoint",
      local_name: "Synthetic local name",
      duration: "About one hour",
      hours: "Verify before visiting",
      estimated_cost: "Unknown",
      booking: "Check the official source",
      transport: "Walk from the synthetic station",
      tips: "Synthetic practical note",
      alternative: "Synthetic indoor option",
      website_url: "https://example.com/place",
      map_url: "https://example.com/map",
      image_url: "https://example.com/place.jpg",
      image_credit: "Synthetic image attribution",
    },
    source_context: { verified_at: "2020-01-01" },
  };
  const id = await as(users.a2, async () => {
    assert.equal(
      await scalar(
        "select role from public.group_members where group_id=$1 and user_id=$2",
        [groupA, users.a2],
      ),
      "member",
    );
    const id = await rpc("create_item", [
      "activities",
      tripA,
      JSON.stringify({
        title: "Synthetic member place suggestion",
        description: "A place suggested before the route is decided",
        why_visit: "An optional idea for the team",
        stop_id: null,
        details,
      }),
      randomUUID(),
    ]);
    assert.deepEqual(
      await query(
        "select stop_id,created_by,details from public.activities where id=$1",
        [id],
      ),
      [{ stop_id: null, created_by: users.a2, details }],
    );
    const edited = {
      ...details,
      presentation: {
        ...details.presentation,
        tips: "Updated by the author",
      },
    };
    assert.deepEqual(
      await scalar(
        "update public.activities set details=$1::jsonb where id=$2 and version=1 returning details",
        [JSON.stringify(edited), id],
      ),
      edited,
    );
    return id;
  });
  await as(users.a3, async () => {
    assert.equal(
      await scalar(
        "select role from public.group_members where group_id=$1 and user_id=$2",
        [groupA, users.a3],
      ),
      "member",
    );
    assert.equal(
      await scalar("select count(*)::int from public.activities where id=$1", [id]),
      1,
    );
    assert.deepEqual(
      await query(
        "update public.activities set details='{}'::jsonb where id=$1 returning id",
        [id],
      ),
      [],
    );
  });
  await as(users.b1, async () => {
    assert.deepEqual(
      await query("select details from public.activities where id=$1", [id]),
      [],
    );
  });
});

test("INV-03: expiration, revocation, invalid tokens and already-member acceptance", async () => {
  const expired = await as(users.a1, () => rpc("create_invitation", [groupA]));
  await db.query(
    "update public.group_invitations set expires_at=now()-interval '1 second' where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
    [expired],
  );
  await as(users.new, () => denied(() => rpc("accept_invitation", [expired])));
  const revoked = await as(users.a1, () => rpc("create_invitation", [groupA]));
  const id = await scalar(
    "select id from public.group_invitations where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
    [revoked],
  );
  await as(users.b1, () => denied(() => rpc("revoke_invitation", [id])));
  await as(users.a1, () => rpc("revoke_invitation", [id]));
  await as(users.new, async () => {
    await denied(() => rpc("accept_invitation", [revoked]));
    await denied(() => rpc("accept_invitation", ["invalid"]));
    await denied(() => rpc("accept_invitation", ["0".repeat(64)]));
  });
  const existing = await as(users.a1, () => rpc("create_invitation", [groupA]));
  await as(users.a2, () => denied(() => rpc("accept_invitation", [existing])));
  assert.equal(
    await scalar(
      "select accepted_at from public.group_invitations where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
      [existing],
    ),
    null,
  );
});

test("PAR: participation is self-only, per trip and separate from membership access", async () => {
  await as(users.a2, async () => {
    assert.equal(
      await scalar("select count(*)::int from public.trips where id=$1", [
        tripA,
      ]),
      1,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.trip_participants where trip_id=$1 and user_id=$2",
        [tripA, users.a2],
      ),
      0,
    );
    await rpc("set_participation", [tripA, "going"]);
    await rpc("set_participation", [tripA, "not_going"]);
    assert.equal(
      await scalar(
        "select status from public.trip_participants where trip_id=$1 and user_id=$2",
        [tripA, users.a2],
      ),
      "not_going",
    );
    await denied(() =>
      db.query(
        "update public.trip_participants set status='going' where trip_id=$1 and user_id=$2",
        [tripA, users.a1],
      ),
    );
    await denied(() =>
      db.query(
        "insert into public.trip_participants(trip_id,user_id,status) values($1,$2,'going')",
        [tripB, users.a2],
      ),
    );
    await denied(() => rpc("set_participation", [tripA, "owner"]));
  });
});

test("Private import preserves rich metadata, maps stops and mints IDs atomically/idempotently", async () => {
  let importedTrip;
  await as(users.a1, async () => {
    const value = payload();
    const request = randomUUID();
    const membersBefore = await query(
      "select user_id,role from public.group_members where group_id=$1 order by user_id",
      [groupA],
    );
    const trip = await rpc("import_private_trip", [
      groupA,
      JSON.stringify(value),
      request,
    ]);
    importedTrip = trip;
    assert.equal(
      await rpc("import_private_trip", [
        groupA,
        JSON.stringify(value),
        request,
      ]),
      trip,
    );
    assert.deepEqual(
      await scalar("select details from public.trips where id=$1", [trip]),
      value.trip.details,
    );
    assert.deepEqual(
      await query(
        "select user_id,role from public.group_members where group_id=$1 order by user_id",
        [groupA],
      ),
      membersBefore,
    );
    assert.deepEqual(
      await query(
        "select user_id,status from public.trip_participants where trip_id=$1",
        [trip],
      ),
      [{ user_id: users.a1, status: "going" }],
    );
    const rows = await query(
      "select a.*,s.name as stop_name from public.activities a join public.trip_stops s on s.id=a.stop_id and s.trip_id=a.trip_id where a.trip_id=$1",
      [trip],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].created_by, users.a1);
    assert.equal(rows[0].description, value.activities[0].description);
    assert.equal(rows[0].why_visit, value.activities[0].why_visit);
    assert.deepEqual(rows[0].details, value.activities[0].details);
    assert.equal(rows[0].stop_name, value.stops[0].name);
    assert.notEqual(rows[0].stop_id, value.stops[0].key);
    assert.equal(
      await scalar(
        "select count(*)::int from public.lodgings where trip_id=$1",
        [trip],
      ),
      1,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.transfers where trip_id=$1",
        [trip],
      ),
      1,
    );
    await denied(() =>
      db.query("delete from public.trip_stops where trip_id=$1", [trip]),
    );
    value.trip.name = "Changed import";
    await denied(() =>
      rpc("import_private_trip", [groupA, JSON.stringify(value), request]),
    );
  });
  await as(users.b1, async () => {
    assert.equal(
      await scalar(
        "select count(*)::int from public.trips where name='Synthetic private itinerary'",
      ),
      0,
    );
    assert.deepEqual(
      await query("select details from public.trips where id=$1", [
        importedTrip,
      ]),
      [],
    );
    assert.deepEqual(
      await query(
        "update public.trips set details='{}'::jsonb where id=$1 returning id",
        [importedTrip],
      ),
      [],
    );
  });
  await as(users.a2, async () =>
    assert.deepEqual(
      await query(
        "update public.trips set details='{}'::jsonb where id=$1 returning id",
        [importedTrip],
      ),
      [],
    ),
  );
  await as(users.a1, async () => {
    const details = { notes: ["Synthetic owner update"] };
    assert.deepEqual(
      await scalar(
        "update public.trips set details=$1::jsonb where id=$2 returning details",
        [JSON.stringify(details), importedTrip],
      ),
      details,
    );
  });
});

test("Private import validation rejects identity injection, invalid sizes/types and all partial records", async () => {
  await as(users.a1, async () => {
    const count = await scalar(
      "select count(*)::int from public.trips where group_id=$1",
      [groupA],
    );
    const variants = [
      (v) => {
        v.group_id = groupB;
      },
      (v) => {
        v.trip.created_by = users.b1;
      },
      (v) => {
        v.trip.details = [];
      },
      (v) => {
        v.trip.details = null;
      },
      (v) => {
        v.trip.details = { oversized: "x".repeat(524288) };
      },
      (v) => {
        v.activities[0].role = "owner";
      },
      (v) => {
        v.activities[0].stop_key = "missing";
      },
      (v) => {
        v.stops.push({ ...v.stops[0] });
      },
      (v) => {
        v.activities[0].details = [];
      },
      (v) => {
        v.activities[0].details = { huge: "x".repeat(102400) };
      },
      (v) => {
        v.activities[0].title = 12;
      },
      (v) => {
        v.trip.timezone = "Not/AZone";
      },
      (v) => {
        v.trip.currency = "euros";
      },
      (v) => {
        v.stops = null;
      },
      (v) => {
        v.schema_version = "1";
      },
      (v) => {
        v.activities = Array.from({ length: 1001 }, () => ({
          title: "Too many",
        }));
      },
      (v) => {
        v.activities[0].description = "x".repeat(20001);
      },
    ];
    for (const mutate of variants) {
      const value = payload();
      mutate(value);
      await denied(
        () =>
          rpc("import_private_trip", [
            groupA,
            JSON.stringify(value),
            randomUUID(),
          ]),
        ["22023", "23514"],
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.trips where group_id=$1",
          [groupA],
        ),
        count,
        "Failed import left a partial trip",
      );
    }
    const request = randomUUID();
    const invalid = payload();
    invalid.activities[0].stop_key = "missing";
    await denied(() =>
      rpc("import_private_trip", [groupA, JSON.stringify(invalid), request]),
    );
    assert.ok(
      await rpc("import_private_trip", [
        groupA,
        JSON.stringify(payload()),
        request,
      ]),
      "Failed attempt must not reserve the request ID",
    );
  });
});

test("PAR-08: removed member loses access with same identity and rejoins without stale participation", async () => {
  await as(users.a2, () => rpc("set_participation", [tripA, "going"]));
  await as(users.a1, async () => {
    await denied(() => rpc("remove_member", [groupA, users.a1]));
    await rpc("remove_member", [groupA, users.a2]);
  });
  await as(users.a2, async () => {
    for (const table of [
      "groups",
      "group_members",
      "trips",
      "trip_stops",
      "activities",
      "lodgings",
      "transfers",
      "trip_participants",
    ])
      assert.equal(
        await scalar(`select count(*)::int from public.${table}`),
        0,
        table,
      );
    await denied(() => rpc("set_participation", [tripA, "going"]));
    await denied(() =>
      db.query(
        "insert into public.activities(trip_id,title) values($1,'Stale write')",
        [tripA],
      ),
    );
  });
  const token = await as(users.a1, () => rpc("create_invitation", [groupA]));
  await as(users.a2, async () => {
    await rpc("accept_invitation", [token]);
    assert.equal(
      await scalar(
        "select count(*)::int from public.trip_participants where user_id=$1",
        [users.a2],
      ),
      0,
    );
  });
});

test("Security-definer functions fix search_path; all exposed tables enable RLS", async () => {
  const functions = await query(
    "select proname,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and prosecdef",
  );
  assert.ok(functions.length > 5);
  for (const fn of functions)
    assert.ok(
      fn.proconfig?.some((c) => c === 'search_path=""'),
      fn.proname,
    );
  const tables = await query(
    "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
  );
  assert.equal(tables.length, 9);
  assert.ok(tables.every((t) => t.relrowsecurity));
  await as(users.a1, () =>
    denied(() => query("select * from app_private.operations")),
  );
});
