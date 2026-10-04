import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { installFixture, GROUP_ID, TRIP_ID, USER_ID, trip } from "./fixture";
import type {
  PlannerSnapshot,
  Day,
  PlanItem,
} from "../../src/lib/collaborationApi";

const DAY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTIVITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function installPlanner(
  page: Page,
  options: {
    role?: "owner" | "member";
    snapshotRole?: "owner" | "member";
    going?: boolean;
    withDay?: boolean;
    withItem?: boolean;
    staleApproval?: boolean;
    loseFirstSave?: boolean;
  } = {},
) {
  const fixture = await installFixture(page, {
    signedIn: true,
    withGroup: true,
    withTrip: true,
    memberRole: options.role ?? "owner",
  });
  const activity = {
    id: ACTIVITY_ID,
    trip_id: TRIP_ID,
    title: "Synthetic garden",
    description: "Reference description",
    why_visit: "A quiet place",
    stop_id: null,
    created_by: USER_ID,
    version: 1,
    details: {
      sources: [
        {
          reference: "source-test",
          source: {
            title: "Synthetic source",
            url: "https://example.test/source",
            checked: "2020-01-01",
          },
        },
      ],
    },
  };
  fixture.activities = [activity];
  fixture.trips = [{ ...trip }];
  const day: Day = {
    id: DAY_ID,
    trip_id: TRIP_ID,
    day_number: 1,
    title: "Synthetic first day",
    stop_id: null,
    notes: "No fixed date yet",
  };
  const item: PlanItem = {
    id: ITEM_ID,
    trip_id: TRIP_ID,
    day_id: DAY_ID,
    activity_id: ACTIVITY_ID,
    title: activity.title,
    position: 0,
    time_slot: null,
    duration_minutes: null,
    notes: "Offline note <script>doNotExecute()</script>",
    is_alternative: false,
    subgroup: "",
  };
  const snapshot: PlannerSnapshot = {
    trip: { ...trip, version: 10, start_date: null },
    days: options.withDay || options.withItem ? [day] : [],
    items: options.withItem ? [item] : [],
    approvals: options.staleApproval
      ? [
          {
            trip_id: TRIP_ID,
            user_id: USER_ID,
            version: 9,
            approved_at: "2026-01-01T00:00:00Z",
          },
        ]
      : [],
    members: [
      {
        group_id: GROUP_ID,
        user_id: USER_ID,
        role: options.snapshotRole ?? options.role ?? "owner",
        display_name: "Synthetic member",
      },
    ],
    participants: [
      {
        trip_id: TRIP_ID,
        user_id: USER_ID,
        status: options.going === false ? "undecided" : "going",
      },
    ],
    activities: [activity],
    stops: [],
  };
  const calls: { operation: string; body: Record<string, any> }[] = [];
  const replays = new Map<string, string>();
  let lost = false;
  let accessLost = false;
  let created = 0;
  await page.route("**/rest/v1/rpc/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).hostname !== "synthetic.supabase.co")
      throw new Error("Only synthetic tests are allowed");
    const operation = new URL(request.url()).pathname.split("/").at(-1)!;
    if (
      ![
        "get_plan_snapshot",
        "save_itinerary_day",
        "delete_itinerary_day",
        "save_itinerary_item",
        "delete_itinerary_item",
        "set_trip_start_date",
        "set_plan_approval",
      ].includes(operation)
    )
      return route.fallback();
    const body = request.postDataJSON() as Record<string, any>;
    calls.push({ operation, body });
    const respond = (payload: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    if (operation === "get_plan_snapshot")
      return respond(accessLost ? null : snapshot);
    const replayKey = `${operation}:${body.p_request_id}`;
    if (body.p_request_id && replays.has(replayKey))
      return respond(replays.get(replayKey));
    if (body.p_expected_version !== snapshot.trip.version)
      return respond({ code: "40001", message: "Trip changed" }, 409);
    let result: string | null = null;
    if (operation === "save_itinerary_day") {
      if (body.p_day_id)
        Object.assign(
          snapshot.days.find((entry) => entry.id === body.p_day_id)!,
          body.p_fields,
        );
      else {
        created++;
        result = `dddddddd-dddd-4ddd-8ddd-${String(created).padStart(12, "0")}`;
        snapshot.days.push({ id: result, trip_id: TRIP_ID, ...body.p_fields });
      }
      result ??= body.p_day_id;
    } else if (operation === "save_itinerary_item") {
      if (body.p_item_id)
        Object.assign(
          snapshot.items.find((entry) => entry.id === body.p_item_id)!,
          body.p_fields,
        );
      else {
        created++;
        result = `eeeeeeee-eeee-4eee-8eee-${String(created).padStart(12, "0")}`;
        snapshot.items.push({ id: result, trip_id: TRIP_ID, ...body.p_fields });
      }
      result ??= body.p_item_id;
    } else if (operation === "delete_itinerary_day") {
      if (snapshot.items.some((entry) => entry.day_id === body.p_day_id))
        return respond({ code: "23503", message: "Day must be empty" }, 409);
      snapshot.days = snapshot.days.filter(
        (entry) => entry.id !== body.p_day_id,
      );
    } else if (operation === "delete_itinerary_item")
      snapshot.items = snapshot.items.filter(
        (entry) => entry.id !== body.p_item_id,
      );
    else if (operation === "set_trip_start_date")
      snapshot.trip.start_date = body.p_start_date;
    else if (operation === "set_plan_approval") {
      snapshot.approvals = snapshot.approvals.filter(
        (entry) => entry.user_id !== USER_ID,
      );
      if (body.p_approved)
        snapshot.approvals.push({
          trip_id: TRIP_ID,
          user_id: USER_ID,
          version: snapshot.trip.version,
          approved_at: "2026-01-01T00:00:00Z",
        });
      return respond(null);
    }
    snapshot.trip.version++;
    if (body.p_request_id && result) replays.set(replayKey, result);
    if (options.loseFirstSave && !lost && operation === "save_itinerary_day") {
      lost = true;
      return respond(
        { message: "Network request failed after response loss" },
        503,
      );
    }
    return respond(result);
  });
  await page.goto(`/?group=${GROUP_ID}&trip=${TRIP_ID}`);
  await page.getByRole("button", { name: "Πρόγραμμα", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Το πρόγραμμά μας", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Φόρτωση προγράμματος…", { exact: true }),
  ).toHaveCount(0);
  return {
    snapshot,
    calls,
    revokeAccess: () => {
      accessLost = true;
      fixture.groups = [];
      fixture.trips = [];
    },
  };
}

test("owner builds relative days and linked alternatives with time, subgroup and optional date", async ({
  page,
}, testInfo) => {
  const { snapshot, calls } = await installPlanner(page);
  await expect(
    page.getByText("Χωρίς ημερομηνίες ακόμα", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Προσθήκη ημέρας", exact: true })
    .click();
  await page
    .getByLabel("Τίτλος ημέρας (προαιρετικό)", { exact: true })
    .fill("Synthetic route day");
  await page
    .getByLabel("Σημειώσεις ημέρας", { exact: true })
    .fill("Room for free time");
  await page
    .getByRole("button", { name: "Αποθήκευση ημέρας", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Ημέρα 1", exact: true }),
  ).toBeVisible();
  expect(
    calls.find((call) => call.operation === "save_itinerary_day")?.body
      .p_expected_version,
  ).toBe(10);
  expect(snapshot.trip.start_date).toBeNull();
  await page
    .getByRole("button", { name: "Προσθήκη στην ημέρα 1", exact: true })
    .click();
  await page
    .getByLabel("Σύνδεση με πρόταση", { exact: true })
    .selectOption(ACTIVITY_ID);
  await page.getByLabel("Ώρα (προαιρετικό)", { exact: true }).fill("10:30");
  await page
    .getByLabel("Διάρκεια σε λεπτά (προαιρετικό)", { exact: true })
    .fill("90");
  await page
    .getByLabel("Υποομάδα (προαιρετικό)", { exact: true })
    .fill("Όσοι θέλουν περίπατο");
  await page.getByLabel("Εναλλακτική επιλογή", { exact: true }).check();
  await page
    .getByRole("button", { name: "Αποθήκευση στο πρόγραμμα", exact: true })
    .click();
  await expect(page.locator(".planner-item")).toHaveCount(1);
  expect(snapshot.items[0]).toMatchObject({
    activity_id: ACTIVITY_ID,
    time_slot: "10:30",
    duration_minutes: 90,
    is_alternative: true,
    subgroup: "Όσοι θέλουν περίπατο",
  });
  await expect(
    page.getByRole("button", { name: "Διαγραφή ημέρας 1", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Ορισμός ημερομηνίας έναρξης", exact: true })
    .click();
  await page
    .locator('.planner-date-editor input[type="date"]')
    .fill("2031-02-03");
  await page
    .getByRole("button", { name: "Αποθήκευση ημερομηνίας", exact: true })
    .click();
  await expect.poll(() => snapshot.trip.start_date).toBe("2031-02-03");
  await expect(
    page.getByText("Χωρίς ημερομηνίες ακόμα", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Αλλαγή ημερομηνίας έναρξης", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Αφαίρεση ημερομηνίας", exact: true })
    .click();
  await expect(
    page.getByText("Χωρίς ημερομηνίες ακόμα", { exact: true }),
  ).toBeVisible();
  expect(snapshot.days[0].notes).toBe("Room for free time");
  expect(
    await page
      .locator(".trip-planner")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("plan-preview.png"),
    fullPage: true,
  });
});

test("member views current snapshot and approves own specific version; changed version shows stale approval", async ({
  page,
}) => {
  const { snapshot } = await installPlanner(page, {
    snapshotRole: "member",
    withDay: true,
    staleApproval: true,
  });
  await expect(
    page.getByRole("button", { name: "Προσθήκη ημέρας", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Επεξεργασία ημέρας 1", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Παλαιότερη έγκριση · έκδοση 9", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Εγκρίνω αυτή την έκδοση", exact: true })
    .click();
  await expect(
    page.getByText("Έγκριση τρέχουσας έκδοσης", { exact: true }),
  ).toBeVisible();
  expect(snapshot.approvals[0].version).toBe(10);
  snapshot.trip.version = 11;
  await page
    .getByRole("button", { name: "Ανανέωση προγράμματος", exact: true })
    .click();
  await expect(
    page.getByText("Παλαιότερη έγκριση · έκδοση 10", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Εγκρίνω αυτή την έκδοση", exact: true }),
  ).toBeVisible();
});

test("snapshot participation controls eligibility even when parent props initially report going", async ({
  page,
}) => {
  await installPlanner(page, { role: "member", going: false, withDay: true });
  await expect(
    page.getByRole("button", { name: "Εγκρίνω αυτή την έκδοση", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Για να εγκρίνεις, δήλωσε πρώτα/)).toBeVisible();
});

test("revoked plan access clears the whole private trip workspace", async ({
  page,
}) => {
  const { revokeAccess } = await installPlanner(page, { withDay: true });
  revokeAccess();
  await page
    .getByRole("button", { name: "Ανανέωση προγράμματος", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Συνθετικό ταξίδι", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Το πρόγραμμά μας", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Συνθετική παρέα", { exact: true })).toHaveCount(
    0,
  );
});

test("response-loss retry reuses creation request ID and creates only one day", async ({
  page,
}) => {
  const { snapshot, calls } = await installPlanner(page, {
    loseFirstSave: true,
  });
  await page
    .getByRole("button", { name: "Προσθήκη ημέρας", exact: true })
    .click();
  await page
    .getByLabel("Τίτλος ημέρας (προαιρετικό)", { exact: true })
    .fill("Retry-safe synthetic day");
  await page
    .getByRole("button", { name: "Αποθήκευση ημέρας", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Δεν μπορέσαμε να συνδεθούμε",
  );
  await expect(
    page.getByLabel("Τίτλος ημέρας (προαιρετικό)", { exact: true }),
  ).toHaveValue("Retry-safe synthetic day");
  await page
    .getByRole("button", { name: "Αποθήκευση ημέρας", exact: true })
    .click();
  await expect(page.locator(".planner-day")).toHaveCount(1);
  const writes = calls.filter(
    (call) => call.operation === "save_itinerary_day",
  );
  expect(writes).toHaveLength(2);
  expect(writes[0].body.p_request_id).toBe(writes[1].body.p_request_id);
  expect(snapshot.days).toHaveLength(1);
});

test("stale editor cannot overwrite a later version; owner can remove items then empty day", async ({
  page,
}) => {
  const { snapshot } = await installPlanner(page, { withItem: true });
  await page
    .getByRole("button", { name: "Επεξεργασία ημέρας 1", exact: true })
    .click();
  await page
    .getByLabel("Σημειώσεις ημέρας", { exact: true })
    .fill("Unsaved local draft");
  snapshot.trip.version++;
  snapshot.days[0].notes = "Saved by another member";
  await page
    .getByRole("button", { name: "Αποθήκευση ημέρας", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Οι αλλαγές σου δεν αποθηκεύτηκαν",
  );
  expect(snapshot.days[0].notes).toBe("Saved by another member");
  await expect(
    page.getByLabel("Σημειώσεις ημέρας", { exact: true }),
  ).toHaveValue("Unsaved local draft");
  await page
    .getByRole("button", { name: "Κλείσιμο φόρμας προγράμματος", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ανανέωση προγράμματος", exact: true })
    .click();
  await expect(
    page.getByText("Saved by another member", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Διαγραφή από το πρόγραμμα Synthetic garden",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Επιβεβαίωση διαγραφής", exact: true })
    .click();
  await expect(page.locator(".planner-item")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Διαγραφή ημέρας 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Επιβεβαίωση διαγραφής", exact: true })
    .click();
  await expect(page.locator(".planner-day")).toHaveCount(0);
});

test("downloads private JSON and self-contained printable HTML with escaped content and source links", async ({
  page,
}, testInfo) => {
  await installPlanner(page, { withItem: true });
  const jsonDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSON προγράμματος", exact: true })
    .click();
  const json = await jsonDownload;
  const jsonPath = testInfo.outputPath("synthetic-plan.json");
  await json.saveAs(jsonPath);
  const decoded = JSON.parse(await readFile(jsonPath, "utf8"));
  expect(decoded.kind).toBe("group-trip-plan-snapshot");
  expect(decoded.trip.version).toBe(10);
  expect(decoded.activities[0].details.sources[0].source.url).toBe(
    "https://example.test/source",
  );
  const htmlDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Offline / εκτύπωση", exact: true })
    .click();
  const html = await htmlDownload;
  const htmlPath = testInfo.outputPath("synthetic-plan.html");
  await html.saveAs(htmlPath);
  const text = await readFile(htmlPath, "utf8");
  expect(text).toContain("&lt;script&gt;doNotExecute()&lt;/script&gt;");
  expect(text).not.toContain("<script>");
  expect(text).not.toMatch(/<img|<script|<link[^>]+stylesheet/i);
  expect(text).toContain('href="https://example.test/source"');
  expect(text).toContain("@media print");
});
