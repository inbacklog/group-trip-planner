import { test, expect } from "@playwright/test";
import { installFixture, GROUP_ID, TRIP_ID } from "./fixture";

test("public entry contains no private content or data creation", async ({
  page,
}) => {
  const state = await installFixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Καλώς ήρθες ξανά" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("Συνθετικό ταξίδι")).toHaveCount(0);
  expect(state.mutations).toHaveLength(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("signup requests only authentication, never seed creation", async ({
  page,
}) => {
  const state = await installFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Δημιούργησε λογαριασμό" }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("synthetic@example.test");
  await page
    .getByLabel("Κωδικός", { exact: true })
    .fill("synthetic-test-password");
  await page
    .getByRole("button", { name: "Δημιουργία λογαριασμού", exact: true })
    .click();
  await expect(
    page.getByText(/Έλεγξε το email σου για επιβεβαίωση/),
  ).toBeVisible();
  expect(state.mutations.map((m) => m.path)).toEqual(["/auth/v1/signup"]);
});

test("authenticated newcomer stays blank through refresh", async ({
  page,
}, testInfo) => {
  const state = await installFixture(page, { signedIn: true });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Όλα αρχίζουν με μια παρέα" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Όλα αρχίζουν με μια παρέα" }),
  ).toBeVisible();
  expect(state.mutations).toHaveLength(0);
  await expect(page.locator(".group-card")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("empty-dashboard.png"),
    fullPage: true,
  });
});

for (const template of ["blank", "china"] as const) {
  test(`trip creation explicitly sends ${template}; default remains blank`, async ({
    page,
  }) => {
    const state = await installFixture(page, {
      signedIn: true,
      withGroup: true,
    });
    await page.goto(`/?group=${GROUP_ID}`);
    await page.getByRole("button", { name: "Νέο ταξίδι", exact: true }).click();
    await expect(
      page.getByRole("radio", { name: /Από την αρχή/ }),
    ).toBeChecked();
    await page
      .getByLabel("Όνομα ταξιδιού", { exact: true })
      .fill("Synthetic new journey");
    if (template === "china")
      await page.getByRole("radio", { name: /Σαγκάη & Πεκίνο/ }).check();
    await page
      .getByRole("button", { name: "Δημιουργία ταξιδιού", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Synthetic new journey", exact: true }),
    ).toBeVisible();
    const call = state.mutations.find((m) =>
      m.path.endsWith("/rpc/create_trip"),
    )!;
    expect(call.body.p_template).toBe(template);
    expect(call.body.p_group_id).toBe(GROUP_ID);
    expect(call.body.p_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      state.mutations.filter((m) => m.path.includes("/rpc/")),
    ).toHaveLength(1);
    if (template === "china") {
      await expect(page.locator(".stop-card")).toHaveCount(2);
      await expect(
        page.getByRole("heading", { name: "Σαγκάη", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Πεκίνο", exact: true }),
      ).toBeVisible();
    } else await expect(page.locator(".stop-card")).toHaveCount(0);
    await expect(page.locator(".idea-card")).toHaveCount(0);
  });
}

test("invitation waits for login and explicit acceptance without creating a trip", async ({
  page,
}) => {
  const state = await installFixture(page);
  const token = "a".repeat(64);
  await page.goto(`/#invite=${token}`);
  await expect(
    page.getByText("Έχεις μια πρόσκληση. Συνδέσου για να την αποδεχτείς."),
  ).toBeVisible();
  expect(page.url()).not.toContain(token);
  await expect(page.getByText("Συνθετική παρέα", { exact: true })).toHaveCount(
    0,
  );
  expect(state.mutations).toHaveLength(0);
  await page
    .getByLabel("Email", { exact: true })
    .fill("synthetic@example.test");
  await page
    .getByLabel("Κωδικός", { exact: true })
    .fill("synthetic-test-password");
  await page.getByRole("button", { name: "Σύνδεση", exact: true }).click();
  await expect(page.getByRole("button", { name: /Αποδοχή/ })).toBeVisible();
  expect(state.mutations.some((m) => m.path.includes("/rpc/"))).toBe(false);
  await page.getByRole("button", { name: /Αποδοχή/ }).click();
  await expect(
    page.getByRole("heading", { name: "Συνθετική παρέα", exact: true }),
  ).toBeVisible();
  expect(
    state.mutations.filter((m) => m.path.includes("/rpc/")).map((m) => m.path),
  ).toEqual(["/rest/v1/rpc/accept_invitation"]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
  ).toBeNull();
});

test("private import previews locally and rejects identity injection without upload", async ({
  page,
}) => {
  const state = await installFixture(page, { signedIn: true, withGroup: true });
  await page.goto(`/?group=${GROUP_ID}`);
  await page.getByRole("button", { name: "Εισαγωγή", exact: true }).click();
  const payload = {
    schema_version: 1,
    kind: "private-trip",
    trip: { name: "Synthetic import" },
    stops: [],
    activities: [],
    lodgings: [],
    transfers: [],
  };
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "synthetic.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(payload)),
    });
  await expect(
    page.getByRole("heading", { name: "Synthetic import" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Επιβεβαίωση εισαγωγής" }),
  ).toBeEnabled();
  expect(state.mutations).toHaveLength(0);
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "forged.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...payload, group_id: GROUP_ID })),
    });
  await expect(page.getByRole("alert")).toContainText(
    "μη υποστηριζόμενα πεδία",
  );
  await expect(
    page.getByRole("button", { name: "Επιβεβαίωση εισαγωγής" }),
  ).toBeDisabled();
  expect(state.mutations).toHaveLength(0);
});

test("new suggestions rely on database author and render untrusted titles as text", async ({
  page,
}) => {
  const state = await installFixture(page, {
    signedIn: true,
    withGroup: true,
    withTrip: true,
  });
  await page.goto(`/?group=${GROUP_ID}&trip=${TRIP_ID}`);
  await page.getByRole("button", { name: "Νέα πρόταση", exact: true }).click();
  const title = "<img src=x onerror=alert(1)>";
  await page.getByLabel("Τίτλος", { exact: true }).fill(title);
  await page
    .getByLabel("Περιγραφή", { exact: true })
    .fill("Synthetic description");
  await page.getByRole("button", { name: "Αποθήκευση", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const call = state.mutations.find((m) =>
    m.path.endsWith("/rpc/create_item"),
  )!;
  expect(call.body.p_fields).not.toHaveProperty("created_by");
  expect(call.body.p_request_id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator(".idea-card img")).toHaveCount(0);
});

test("a temporary invitation error keeps the invitation available for retry", async ({
  page,
}) => {
  await installFixture(page, { signedIn: true });
  let attempts = 0;
  await page.route("**/rest/v1/rpc/accept_invitation", async (route) => {
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Temporary network failure" }),
      });
    return route.fallback();
  });
  await page.goto("/#invite=" + "a".repeat(64));
  await page.getByRole("button", { name: /Αποδοχή/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: /Αποδοχή/ })).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
  ).toBe("a".repeat(64));
  await page.getByRole("button", { name: /Αποδοχή/ }).click();
  await expect(
    page.getByRole("heading", { name: "Συνθετική παρέα", exact: true }),
  ).toBeVisible();
});

test("legacy handoff preview converts privately and imports only after confirmation", async ({
  page,
}) => {
  const state = await installFixture(page, { signedIn: true, withGroup: true });
  await page.goto(`/?group=${GROUP_ID}`);
  await page.getByRole("button", { name: "Εισαγωγή", exact: true }).click();
  const legacy = {
    handoffFormat: "project-china-private-handoff-v1",
    classification: "private",
    trip: {
      title: "Synthetic legacy handoff",
      timezone: "UTC",
      currency: "EUR",
      notes: ["Synthetic note"],
      partySize: 7,
    },
    legacyDataset: {
      meta: {},
      sources: {},
      activities: [],
      hotels: [],
      transfers: [],
      days: [],
      feeGroups: {},
    },
    provenance: { legacyItineraryIsAssistantDraftNotGroupApproval: true },
  };
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "synthetic-handoff.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(legacy)),
    });
  await expect(
    page.getByRole("heading", { name: "Synthetic legacy handoff" }),
  ).toBeVisible();
  expect(state.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Επιβεβαίωση εισαγωγής" }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic legacy handoff" }),
  ).toBeVisible();
  const call = state.mutations.find((m) =>
    m.path.endsWith("/rpc/import_private_trip"),
  )!;
  expect(call.body.p_group_id).toBe(GROUP_ID);
  expect((call.body.p_payload as any).kind).toBe("private-trip");
  expect(
    (call.body.p_payload as any).trip.details.legacy_handoff.trip.partySize,
  ).toBe(7);
  expect(state.mutations).toHaveLength(1);
});

test("schema errors stay explicit without silently showing a demo", async ({
  page,
}) => {
  await installFixture(page, { signedIn: true, failGroups: true });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Η βάση δεδομένων δεν είναι έτοιμη",
  );
  await expect(page.locator(".group-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Δοκίμασε ξανά" }),
  ).toBeVisible();
});

test("logout clears the private workspace", async ({ page, isMobile }) => {
  await installFixture(page, {
    signedIn: true,
    withGroup: true,
    withTrip: true,
  });
  await page.goto(`/?group=${GROUP_ID}&trip=${TRIP_ID}`);
  await expect(
    page.getByRole("heading", { name: "Συνθετικό ταξίδι", exact: true }),
  ).toBeVisible();
  if (isMobile)
    await page.getByRole("button", { name: "Άνοιγμα πλοήγησης" }).click();
  await page.getByRole("button", { name: "Αποσύνδεση", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Καλώς ήρθες ξανά" }),
  ).toBeVisible();
  await expect(page.getByText("Συνθετικό ταξίδι")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
  expect(
    await page.evaluate(() => localStorage.getItem("sb-synthetic-auth-token")),
  ).toBeNull();
});
