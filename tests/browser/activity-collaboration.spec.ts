import { expect, test, type Page } from "@playwright/test";
import { installFixture, GROUP_ID, TRIP_ID, USER_ID } from "./fixture";

const ACTIVITY_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_ACTIVITY_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_ID = "88888888-8888-4888-8888-888888888888";
const NOT_GOING_ID = "99999999-9999-4999-8999-999999999999";
const UNDECIDED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FORMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWN_COMMENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_COMMENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const timestamp = "2026-01-02T09:00:00.000Z";

async function collaborationFixture(
  page: Page,
  options: {
    role?: "owner" | "member";
    loseFirstCommentResponse?: boolean;
    conflictEdit?: boolean;
  } = {},
) {
  const base = await installFixture(page, {
    signedIn: true,
    withGroup: true,
    withTrip: true,
    memberRole: options.role ?? "owner",
  });
  base.activities = [
    {
      id: ACTIVITY_ID,
      trip_id: TRIP_ID,
      title: "Συνθετικός κήπος",
      description: "Ένας ιδιωτικός χώρος δοκιμής.",
      stop_id: null,
      details: {},
      created_by: USER_ID,
      version: 1,
    },
    {
      id: SECOND_ACTIVITY_ID,
      trip_id: TRIP_ID,
      title: "Συνθετικό μουσείο",
      description: "Δεύτερη ιδέα της παρέας.",
      stop_id: null,
      details: {},
      created_by: OTHER_ID,
      version: 1,
    },
  ];
  const members = [
    {
      group_id: GROUP_ID,
      user_id: USER_ID,
      role: options.role ?? "owner",
      display_name: "Ελένη",
    },
    {
      group_id: GROUP_ID,
      user_id: OTHER_ID,
      role: "member",
      display_name: "Νίκος",
    },
    {
      group_id: GROUP_ID,
      user_id: NOT_GOING_ID,
      role: "member",
      display_name: "Μαρία",
    },
    {
      group_id: GROUP_ID,
      user_id: UNDECIDED_ID,
      role: "member",
      display_name: "Άννα",
    },
    {
      group_id: GROUP_ID,
      user_id: MISSING_ID,
      role: "member",
      display_name: "Πέτρος",
    },
  ];
  const participants = [
    { trip_id: TRIP_ID, user_id: USER_ID, status: "going" },
    { trip_id: TRIP_ID, user_id: OTHER_ID, status: "going" },
    { trip_id: TRIP_ID, user_id: NOT_GOING_ID, status: "not_going" },
    { trip_id: TRIP_ID, user_id: UNDECIDED_ID, status: "undecided" },
    { trip_id: TRIP_ID, user_id: FORMER_ID, status: "going" },
  ];
  const preference = (
    userId: string,
    choice: string,
    activityId = ACTIVITY_ID,
  ) => ({
    trip_id: TRIP_ID,
    activity_id: activityId,
    user_id: userId,
    choice,
    priority: 0,
    note: "",
    updated_at: timestamp,
  });
  const comment = (id: string, createdBy: string, body: string) => ({
    id,
    trip_id: TRIP_ID,
    activity_id: ACTIVITY_ID,
    created_by: createdBy,
    body,
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });
  const state = {
    members,
    participants,
    preferences: [
      preference(USER_ID, "yes"),
      preference(OTHER_ID, "maybe"),
      preference(NOT_GOING_ID, "must"),
      preference(UNDECIDED_ID, "must"),
      preference(MISSING_ID, "must"),
      preference(FORMER_ID, "must"),
      preference(OTHER_ID, "must", SECOND_ACTIVITY_ID),
    ],
    comments: [
      comment(OWN_COMMENT_ID, USER_ID, "Το αρχικό μου σχόλιο."),
      comment(OTHER_COMMENT_ID, OTHER_ID, "Μήπως να πάμε το πρωί;"),
    ],
    mutations: [] as { name: string; body: Record<string, any> }[],
    loseAccess: false,
  };
  const createdRequests = new Map<string, string>();
  let failedFirst = false;
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    const name = url.pathname.split("/").at(-1)!;
    if (name === "group_members") return respond(members);
    if (name === "trip_participants") return respond(participants);
    if (name === "activities") {
      if (state.loseAccess) return respond([]);
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      return respond(
        id
          ? base.activities.filter((activity) => activity.id === id)
          : base.activities,
      );
    }
    if (name === "get_activity_collaboration") {
      if (state.loseAccess) return respond(null);
      const body = request.postDataJSON();
      return respond({
        preferences: state.preferences.filter(
          (row) => row.activity_id === body.p_activity_id,
        ),
        comments: state.comments.filter(
          (row) => row.activity_id === body.p_activity_id,
        ),
        members: state.members,
        participants: state.participants,
      });
    }
    if (name === "get_preference_snapshot") {
      if (state.loseAccess) return respond(null);
      return respond({
        preferences: state.preferences,
        members: state.members,
        participants: state.participants,
      });
    }
    if (name === "activity_preferences") {
      const id = url.searchParams.get("activity_id")?.replace(/^eq\./, "");
      return respond(
        id
          ? state.preferences.filter((row) => row.activity_id === id)
          : state.preferences,
      );
    }
    if (name === "activity_comments") {
      const id = url.searchParams.get("activity_id")?.replace(/^eq\./, "");
      return respond(
        id
          ? state.comments.filter((row) => row.activity_id === id)
          : state.comments,
      );
    }
    if (
      ![
        "set_activity_preference",
        "create_activity_comment",
        "edit_activity_comment",
        "delete_activity_comment",
      ].includes(name)
    )
      return route.fallback();
    const body = request.postDataJSON();
    state.mutations.push({ name, body });
    if (name === "set_activity_preference") {
      state.preferences = state.preferences.filter(
        (row) =>
          !(row.activity_id === body.p_activity_id && row.user_id === USER_ID),
      );
      if (body.p_choice !== null)
        state.preferences.push({
          ...preference(USER_ID, body.p_choice, body.p_activity_id),
          priority: body.p_priority,
          note: body.p_note,
        });
      return respond(null);
    }
    if (name === "create_activity_comment") {
      let id = createdRequests.get(body.p_request_id);
      if (!id) {
        id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
        createdRequests.set(body.p_request_id, id);
        state.comments.push(comment(id, USER_ID, body.p_body));
      }
      if (options.loseFirstCommentResponse && !failedFirst) {
        failedFirst = true;
        return route.abort("failed");
      }
      return respond(id);
    }
    if (name === "edit_activity_comment") {
      const row = state.comments.find(
        (entry) => entry.id === body.p_comment_id,
      )!;
      if (options.conflictEdit) {
        row.body = "Νεότερο σχόλιο από άλλη καρτέλα.";
        row.version = 2;
        return respond(
          {
            code: "40001",
            message: "Το σχόλιο άλλαξε. Ανανέωσε και δοκίμασε ξανά.",
          },
          409,
        );
      }
      row.body = body.p_body;
      row.version += 1;
      row.updated_at = "2026-01-02T10:00:00.000Z";
      return respond(null);
    }
    state.comments = state.comments.filter(
      (row) => row.id !== body.p_comment_id,
    );
    return respond(null);
  });
  return state;
}

async function openGarden(page: Page) {
  await page.goto(`/?group=${GROUP_ID}&trip=${TRIP_ID}`);
  await page
    .locator(".idea-card")
    .filter({
      has: page.getByRole("heading", { name: "Συνθετικός κήπος", exact: true }),
    })
    .locator(".idea-main")
    .click();
  const section = page.getByRole("region", {
    name: "Προτιμήσεις και συζήτηση",
  });
  await expect(
    section.getByRole("heading", { name: "Τι λέει η παρέα;" }),
  ).toBeVisible();
  await expect(
    section.getByRole("radio", { name: "Ναι", exact: true }),
  ).toBeChecked();
  return section;
}

test("preference changes and clearing are explicit and count only current going members", async ({
  page,
}, testInfo) => {
  const state = await collaborationFixture(page);
  const section = await openGarden(page);
  await expect(
    section.getByText("2 / 2 απάντησαν", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByLabel("Οπωσδήποτε: 0", { exact: true }),
  ).toBeVisible();
  await section.getByRole("radio", { name: "Οπωσδήποτε", exact: true }).check();
  await section
    .getByLabel("Προσωπική προτεραιότητα", { exact: true })
    .selectOption("5");
  await section.getByLabel(/Η σημείωσή σου/).fill("Ας πάμε νωρίς.");
  expect(state.mutations).toHaveLength(0);
  await section
    .getByRole("button", { name: "Αποθήκευση προτίμησης", exact: true })
    .click();
  await expect(
    section.getByLabel("Οπωσδήποτε: 1", { exact: true }),
  ).toBeVisible();
  const saved = state.mutations.find(
    (row) => row.name === "set_activity_preference",
  )!;
  expect(saved.body).toEqual({
    p_activity_id: ACTIVITY_ID,
    p_choice: "must",
    p_priority: 5,
    p_note: "Ας πάμε νωρίς.",
  });
  await section.locator("summary").click();
  await expect(section.getByText("Μαρία", { exact: true })).toBeVisible();
  await expect(
    section.getByText("Δεν συμμετέχει · εκτός συνόλων", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByText("Δεν έχει δηλώσει συμμετοχή · εκτός συνόλων", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("activity-votes-comments.png"),
    fullPage: true,
  });
  await section
    .getByRole("radio", { name: "Χωρίς απάντηση", exact: true })
    .check();
  await section
    .getByRole("button", { name: "Αποθήκευση προτίμησης", exact: true })
    .click();
  await expect(
    section.getByText("1 / 2 απάντησαν", { exact: true }),
  ).toBeVisible();
  expect(state.mutations.at(-1)?.body.p_choice).toBeNull();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("overview ranking excludes nonparticipants and former members without inventing consensus", async ({
  page,
}, testInfo) => {
  await collaborationFixture(page);
  await page.goto(`/?group=${GROUP_ID}&trip=${TRIP_ID}`);
  await expect(page.getByText("2 από 5 θα έρθουν", { exact: false })).toBeVisible();
  await page
    .getByRole("button", { name: "Προτιμήσεις παρέας", exact: true })
    .click();
  const overview = page.getByRole("region", { name: "Σύνοψη προτιμήσεων" });
  await expect(
    overview.locator(".preference-ranking-row").first(),
  ).toContainText("Συνθετικό μουσείο");
  const garden = overview
    .locator(".preference-ranking-row")
    .filter({ hasText: "Συνθετικός κήπος" });
  await expect(
    garden.getByText("2 / 2 απάντησαν", { exact: true }),
  ).toBeVisible();
  await expect(
    garden.getByLabel("Οπωσδήποτε: 0", { exact: true }),
  ).toBeVisible();
  await expect(
    overview.getByText(
      /1 δεν συμμετέχουν, 1 το σκέφτονται, 1 δεν έχουν δηλώσει συμμετοχή/,
    ),
  ).toBeVisible();
  await expect(
    overview.getByText(/Καμία επιλογή δεν προστίθεται αυτόματα στο πρόγραμμα/),
  ).toBeVisible();
  await overview.getByLabel("Ταξινόμηση", { exact: true }).selectOption("yes");
  await expect(
    overview.locator(".preference-ranking-row").first(),
  ).toContainText("Συνθετικός κήπος");
  await page.screenshot({
    path: testInfo.outputPath("preference-overview.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("lost comment response retries the same request and does not create duplicate comments", async ({
  page,
}) => {
  const state = await collaborationFixture(page, {
    loseFirstCommentResponse: true,
  });
  const section = await openGarden(page);
  await section
    .getByLabel("Νέο σχόλιο", { exact: true })
    .fill("Να ελέγξουμε τις ώρες λειτουργίας.");
  await section
    .getByRole("button", { name: "Προσθήκη σχολίου", exact: true })
    .click();
  await expect(section.getByRole("alert")).toBeVisible();
  await expect(section.getByLabel("Νέο σχόλιο", { exact: true })).toHaveValue(
    "Να ελέγξουμε τις ώρες λειτουργίας.",
  );
  await section
    .getByRole("button", { name: "Προσθήκη σχολίου", exact: true })
    .click();
  await expect(
    section
      .locator(".comment-body")
      .filter({ hasText: "Να ελέγξουμε τις ώρες λειτουργίας." }),
  ).toHaveCount(1);
  const calls = state.mutations.filter(
    (row) => row.name === "create_activity_comment",
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].body.p_request_id).toBe(calls[1].body.p_request_id);
  expect(calls[0].body).not.toHaveProperty("created_by");
  expect(
    state.comments.filter(
      (row) => row.body === "Να ελέγξουμε τις ώρες λειτουργίας.",
    ),
  ).toHaveLength(1);
});

test("ordinary member only edits their own comments and conflict refresh retrieves the new version", async ({
  page,
}) => {
  const state = await collaborationFixture(page, {
    role: "member",
    conflictEdit: true,
  });
  const section = await openGarden(page);
  await expect(
    section.getByRole("button", {
      name: "Επεξεργασία σχολίου Ελένη",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", {
      name: "Επεξεργασία σχολίου Νίκος",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    section.getByRole("button", {
      name: "Διαγραφή σχολίου Νίκος",
      exact: true,
    }),
  ).toHaveCount(0);
  await section
    .getByRole("button", { name: "Επεξεργασία σχολίου Ελένη", exact: true })
    .click();
  await section
    .getByLabel("Επεξεργασία σχολίου", { exact: true })
    .fill("Αλλαγή από αυτή την καρτέλα.");
  await section
    .getByRole("button", { name: "Αποθήκευση σχολίου", exact: true })
    .click();
  await expect(section.getByRole("alert")).toContainText("Έγινε αλλαγή από άλλο μέλος");
  expect(state.mutations.at(-1)?.body.p_expected_version).toBe(1);
  await section
    .getByRole("button", {
      name: "Ανανέωση προτιμήσεων και σχολίων",
      exact: true,
    })
    .click();
  await expect(
    section.getByText("Νεότερο σχόλιο από άλλη καρτέλα.", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByLabel("Επεξεργασία σχολίου", { exact: true }),
  ).toHaveCount(0);
});

test("admin deletion is confirmed and revoked snapshot clears the whole private detail", async ({
  page,
}) => {
  const state = await collaborationFixture(page);
  const section = await openGarden(page);
  await section
    .getByRole("button", { name: "Διαγραφή σχολίου Νίκος", exact: true })
    .click();
  expect(state.mutations).toHaveLength(0);
  await section
    .getByRole("button", { name: "Διαγραφή σχολίου", exact: true })
    .click();
  await expect(
    section.getByText("Μήπως να πάμε το πρωί;", { exact: true }),
  ).toHaveCount(0);
  expect(state.mutations[0].body).toEqual({
    p_comment_id: OTHER_COMMENT_ID,
    p_expected_version: 1,
  });
  state.loseAccess = true;
  await section
    .getByRole("button", {
      name: "Ανανέωση προτιμήσεων και σχολίων",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Το αρχικό μου σχόλιο.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Προτιμήσεις και συζήτηση" }),
  ).toHaveCount(0);
});

test("refreshed atomic snapshot excludes a newly withdrawn participant and removes stale admin controls", async ({
  page,
}) => {
  const state = await collaborationFixture(page);
  const section = await openGarden(page);
  await expect(
    section.getByText("2 / 2 απάντησαν", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", {
      name: "Διαγραφή σχολίου Νίκος",
      exact: true,
    }),
  ).toBeVisible();
  state.participants = state.participants.map((person) =>
    person.user_id === OTHER_ID ? { ...person, status: "not_going" } : person,
  );
  state.members = state.members.map((member) =>
    member.user_id === USER_ID ? { ...member, role: "member" } : member,
  );
  await section
    .getByRole("button", {
      name: "Ανανέωση προτιμήσεων και σχολίων",
      exact: true,
    })
    .click();
  await expect(
    section.getByText("1 / 1 απάντησαν", { exact: true }),
  ).toBeVisible();
  await expect(section.getByLabel("Ίσως: 0", { exact: true })).toBeVisible();
  await expect(
    section.getByRole("button", {
      name: "Διαγραφή σχολίου Νίκος",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Προτιμήσεις παρέας", exact: true })
    .click();
  const overview = page.getByRole("region", { name: "Σύνοψη προτιμήσεων" });
  const garden = overview
    .locator(".preference-ranking-row")
    .filter({ hasText: "Συνθετικός κήπος" });
  await expect(
    garden.getByText("1 / 1 απάντησαν", { exact: true }),
  ).toBeVisible();
  await expect(garden.getByLabel("Ίσως: 0", { exact: true })).toBeVisible();
  state.loseAccess = true;
  await overview.getByRole("button", { name: "Ανανέωση", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Σύνοψη προτιμήσεων" }),
  ).toHaveCount(0);
});
