# Database contract

Migrations: `supabase/migrations/202610040001_private_groups.sql` and `202610040002_collaboration.sql`. For a fresh installation, `supabase/INSTALL_ALL.sql` bundles both into one transaction with a collision guard; run the whole bundle once, not the migrations again afterward. An existing installation applies only missing migrations after inspection. The bundle is generated with `pnpm sql:bundle` and checked against both sources by tests. Supabase supplies `auth.users` / `auth.uid()`; no extension is required.

All public tables have RLS. Only authenticated, current group members can read group data. Owners/admins manage trips, stops, accommodation and transfers. Members create activities and edit/delete their own activities; owners/admins can manage all activities. Anonymous access returns no private rows. Membership changes are checked from current database state, not cached JWT claims. There is no public user/email directory and no owner identity exception.

## Tables

- `groups`: `id`, `name`, `created_by`, `created_at`.
- `group_members`: `group_id`, `user_id`, `role` (`owner`, `admin`, `member`), `joined_at`. UI displays generic member identifiers; no email data is exposed.
- `trips`: `id`, `group_id`, `name`, `currency`, `timezone`, `details` (JSON object, at most 512 KiB), `created_by`, `version`, `created_at`.
- `trip_participants`: `trip_id`, `user_id`, `status` (`going`, `undecided`, `not_going`), `updated_at`. Participation is separate from group access.
- `trip_stops`: `id`, `trip_id`, `name`, `position`, `version`, `created_at`.
- `activities`: `id`, `trip_id`, nullable `stop_id`, `title`, `description`, `why_visit`, `details` (JSON object), `created_by`, `version`, `created_at`.
- `lodgings` / `transfers`: activity shape without `why_visit`.
- `group_invitations`: `id`, `group_id`, `created_by`, `created_at`, `expires_at`, `revoked_at`, `accepted_at`, `accepted_by`. Only owners/admins can read these metadata columns; token digests are never exposed.
- `activity_preferences`: `trip_id`, `activity_id`, `user_id`, `choice` (`must`, `yes`, `maybe`, `skip`), `priority` (0–5), `note` (≤1,000 chars), `updated_at`. One row per activity/user; clearing removes the row. Unanswered is not a negative vote.
- `activity_comments`: `id`, `trip_id`, `activity_id`, `created_by`, `body` (1–3,000 chars), `version`, `created_at`, `updated_at`. Only authors edit; authors or editors delete.
- `itinerary_days`: `id`, `trip_id`, unique `day_number` (1–365), `title`, optional same-trip `stop_id`, `notes`.
- `itinerary_items`: `id`, `trip_id`, same-trip `day_id`, optional same-trip `activity_id`, `title`, `position`, optional `time_slot` (HH:MM), optional `duration_minutes`, `notes`, `is_alternative`, `subgroup`.
- `plan_approvals`: `trip_id`, `user_id`, `version` (the approved `trips.version`), `approved_at`.
- Additional columns: `trips.start_date` (optional date) and `group_members.display_name` (≤80 chars, self-editable within the group).

The new tables grant SELECT only to current members; writes go through RPCs. Trip versions change on official-plan, route/content/date and participation updates. Votes, comments, display names and approvals do not change the trip version. Only current `going` members can approve, and only approvals matching the displayed version count. Removing a group member clears their preferences and approvals; comments remain attributed to their original author. Relative days retain IDs/content when a start date is added or cleared; imported flight/booking anchors are not shifted.

Collaboration RPCs: `set_activity_preference(p_activity_id,p_choice,p_priority,p_note)`, `create_activity_comment(p_activity_id,p_body,p_request_id)`, `edit_activity_comment(p_comment_id,p_body,p_expected_version)`, `delete_activity_comment(p_comment_id,p_expected_version)`, `save_itinerary_day(p_trip_id,p_day_id,p_fields,p_expected_version,p_request_id)`, `delete_itinerary_day(p_day_id,p_expected_version)`, `save_itinerary_item(p_trip_id,p_item_id,p_fields,p_expected_version,p_request_id)`, `delete_itinerary_item(p_item_id,p_expected_version)`, `set_trip_start_date(p_trip_id,p_start_date,p_expected_version)`, `set_plan_approval(p_trip_id,p_expected_version,p_approved)`, `set_member_display_name(p_group_id,p_display_name)`.

Day/item save returns UUID and accepts null item/day ID for creation; unchanged retries reuse a request UUID and the original expected trip version. Field changes require a new request UUID. Plan saves lock the trip and reject stale versions; comment edits use the comment version. Day deletion requires an empty day. Foreign activity/day/stop links cannot cross trips or groups.

`get_plan_snapshot(p_trip_id)` returns `{trip,days,items,approvals,members,participants,activities,stops}` using one SQL statement, so the version and content share a database snapshot. It runs with caller permissions/RLS and returns null for an inaccessible trip. The planner and offline exports use this same snapshot. The export is a private local copy, not a public share link or a re-import/restore format.

`get_activity_collaboration(p_activity_id)` returns `{preferences,comments,members,participants}` for one accessible activity. `get_preference_snapshot(p_trip_id)` returns `{preferences,members,participants}` for the trip overview. Both use one stable invoker statement with RLS and return null for inaccessible/deleted parents. UI counts and moderation controls use the fresh roster, rather than relying on cached parent props. A denied/null snapshot clears the whole private workspace through the access-loss callback.

Rich travel metadata and source fields remain in each private record's `details` object. Trip-level details preserve anchors, draft days, planning notes, source provenance and other context as inert private metadata. They do not create group memberships, account preferences, actual bookings or approvals. Blank and China-starter trips have empty details. Owners/admins may update trip details under the existing trip policy. The server does not alter source verification timestamps. `stop_id` must refer to a stop in the same trip. Removing a stop referenced by a record is rejected; clear/reassign those references first.

Authenticated clients may insert/update/delete stops and trip content subject to permissions. Table defaults mint IDs and set the current author. Updates to parent IDs, author IDs, or versions are not granted. An update trigger increments versions; clients should use `.eq('version', expectedVersion)` and treat zero updated rows as a conflict. Trip content changes also increment `trips.version`. Direct membership/participation/invitation writes are unavailable.

## RPCs

Every function below is called through `supabase.rpc(name, namedArguments)` and returns a scalar value, not a row set. Authentication is required.

| Name | Arguments | Return |
|---|---|---|
| `create_group` | `p_name text`, `p_request_id uuid` | new/existing group UUID |
| `create_trip` | `p_group_id uuid`, `p_name text`, `p_template text` (`blank` or `china`), `p_request_id uuid` | new/existing trip UUID |
| `create_stop` | `p_trip_id uuid`, `p_name text`, `p_position integer`, `p_request_id uuid` | new/existing stop UUID |
| `create_item` | `p_table text`, `p_trip_id uuid`, `p_fields jsonb`, `p_request_id uuid` | new/existing item UUID |
| `create_invitation` | `p_group_id uuid` | raw invite token (copy once) |
| `accept_invitation` | `p_token text` | group UUID |
| `revoke_invitation` | `p_invitation_id uuid` | void |
| `remove_member` | `p_group_id uuid`, `p_user_id uuid` | void |
| `set_participation` | `p_trip_id uuid`, `p_status text` | void |
| `reorder_stops` | `p_trip_id uuid`, `p_stop_ids uuid[]`, `p_expected_version integer` | new trip version |
| `import_private_trip` | `p_group_id uuid`, `p_payload jsonb`, `p_request_id uuid` | new/existing trip UUID |

Trip creation/import requires owner/admin role. Empty signup/login creates no rows. `blank` creates zero stops; `china` creates exactly `Σαγκάη` and `Πεκίνο`, positions 0 and 1, and no content. The creator initially participates as `going`. Creation is atomic and idempotent per caller + operation kind + request UUID. Reusing an operation UUID with different arguments raises an error. Retry only with the same UUID and unchanged arguments. A removed member cannot recover inaccessible results by retrying an old operation.

UI stop/item creation uses `create_stop` / `create_item` to protect retries after a lost response. Keep the same request UUID while retrying an unchanged submitted draft. `create_item.p_table` permits only `activities`, `lodgings` or `transfers`. Its fields allow required `title`, optional `description`, `details`, `stop_id` (UUID or null), and `why_visit` for activities only. Unknown identity, parent or author fields are rejected. Record IDs and authors are assigned by the server. Activity creation is available to current members; stops/lodgings/transfers require owner/admin. Every retry rechecks current membership and role before returning a previous result. Direct inserts remain permission checked, but have no operation idempotency and are not used by the UI creation forms.

Invitations expire after seven days, are single-use, join only as `member`, and store only a SHA-256 digest. Raw tokens should remain outside logs and analytics. An existing member cannot consume an invitation. A user is authenticated before acceptance; there is no unauthenticated preview. Owners cannot be removed through `remove_member`; admins may remove ordinary members, owners may also remove admins. Rejoining creates no active participation until that member explicitly chooses a status.

Rich item forms use the existing `details.presentation` object; no new SQL migration is required. `kind` is `activity`, `place` or `food`. String fields cover location/category/local name, duration, opening hours, estimated cost with user-specified currency/unit, booking, transport, tips, alternative, website/map/image URLs and image credit. UI limits and URL validation supplement the database object/100 KiB constraint; display sanitizes URLs even for values inserted directly through the API. Editing merges these values while preserving `legacy_record`, resolved sources and unknown metadata. An explicit empty string overrides a legacy fallback. Legacy numeric `hours` means visit duration, not opening hours. Zero cost bounds retain their status/notes instead of being labelled free. Members can propose places with `stop_id=null`; this does not grant route-stop editing. Images are external HTTPS links, not Storage uploads.

## Private import schema

```json
{
  "schema_version": 1,
  "kind": "private-trip",
  "trip": { "name": "Private trip", "currency": "EUR", "timezone": "Asia/Shanghai", "details": {} },
  "stops": [{ "key": "stop-a", "name": "Private stop" }],
  "activities": [{ "title": "Private idea", "stop_key": "stop-a", "description": "", "why_visit": "", "details": {} }],
  "lodgings": [{ "title": "Private lodging", "stop_key": "stop-a", "description": "", "details": {} }],
  "transfers": [{ "title": "Private transfer", "description": "", "details": {} }]
}
```

Required: root `schema_version`, `kind`, `trip`, and all four arrays; `trip.name`; every stop `key` and `name`; every record `title`. Currency defaults to EUR; timezone to UTC; optional descriptions to empty strings; omitted record or trip details to `{}`. `stop_key` may be omitted or null. Unknown fields are rejected at root, trip, stop and record levels, including imported IDs, roles and authors. Nested details must be an object and are preserved as inert data. Identity-looking fields inside details have no authorization effect.

Limits: JSON payload 2 MiB; at most 100 stops, 1,000 activities, 200 lodgings and 200 transfers; trip/stop/group names 1–120 characters, titles 1–200; stop key 1–100; descriptions at most 20,000 characters and why_visit 10,000; record details at most 100 KiB and trip details at most 512 KiB; uppercase three-letter currency; valid IANA/PostgreSQL timezone name. Duplicate stop keys, unknown stop references, malformed types or identity fields reject the entire import. All persistent IDs are minted in the database. Importing never maps legacy votes or members to accounts.

`reorder_stops` atomically changes the complete stop order under a trip row lock. Pass all current stop UUIDs exactly once and the loaded `trips.version`. Stale versions, foreign stops or incomplete/duplicate lists reject the operation without partial edits.

## Verification scope

`npm run test:database` uses PGlite's actual PostgreSQL engine with a local `auth.users`/`auth.uid()` shim and authenticated/anon roles. The fixture enables broad default table/function privileges before applying the migration, verifying that explicit revokes take effect. It exercises grants, RLS, functions, constraints and rollback, including failure on the second template stop. Membership locks serialize participation/create/import against member removal; the sequential engine tests removal and rejoin behavior but cannot simulate competing database connections. It does not verify Supabase Auth, PostgREST's HTTP/column behavior, SMTP, hosted configuration, Realtime, parallel network transactions or the deployed remote database. A real Supabase integration check is still needed before claiming hosted readiness.
