import { test, expect } from "@playwright/test";
import { installFixture, GROUP_ID, TRIP_ID, USER_ID } from "./fixture";

test("ordinary member adds a place with rich details, safe links and optional photo", async ({
  page,
}, testInfo) => {
  const state = await installFixture(page, {
    signedIn: true,
    withGroup: true,
    withTrip: true,
    memberRole: "member",
  });
  await page.route("https://images.example.test/place.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="300"><rect width="720" height="300" fill="#d6e2c3"/><circle cx="360" cy="145" r="80" fill="#f0c47b"/></svg>',
    }),
  );
  await page.goto(`/?group=${GROUP_ID}&trip=${TRIP_ID}`);
  await expect(
    page.getByRole("button", { name: "Προσθήκη στάσης", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Νέα πρόταση", exact: true }).click();
  await page
    .getByLabel("Τίτλος", { exact: true })
    .fill("Synthetic riverside garden");
  await page
    .getByLabel("Είδος πρότασης", { exact: true })
    .selectOption("place");
  await page
    .getByLabel("Περιγραφή", { exact: true })
    .fill("A quiet garden suggested by a member.");
  await page
    .getByLabel("Τοποθεσία / διεύθυνση", { exact: true })
    .fill("Synthetic river district");
  await page.getByLabel("Διάρκεια", { exact: true }).fill("1–2 hours");
  await page
    .getByLabel("Ενδεικτικό κόστος", { exact: true })
    .fill("12 EUR / person · estimate");
  await page
    .getByLabel("Σύνδεσμος πληροφοριών", { exact: true })
    .fill("https://example.test/garden");
  await page
    .getByLabel("Σύνδεσμος χάρτη", { exact: true })
    .fill("https://example.test/map");
  await page
    .getByLabel("Σύνδεσμος φωτογραφίας (HTTPS)", { exact: true })
    .fill("https://images.example.test/place.svg");
  await page
    .getByLabel("Πηγή / δημιουργός φωτογραφίας", { exact: true })
    .fill("Synthetic test illustration");
  await page.getByRole("button", { name: "Αποθήκευση", exact: true }).click();
  await expect(page.locator(".idea-card")).toHaveCount(1);
  const call = state.mutations.find((entry) =>
    entry.path.endsWith("/rpc/create_item"),
  )!;
  expect(call.body.p_fields.stop_id).toBeNull();
  expect(call.body.p_fields.details.presentation.kind).toBe("place");
  expect(call.body.p_fields).not.toHaveProperty("created_by");
  await page.getByLabel("Αναζήτηση καταχωρίσεων").fill("river district");
  await expect(page.locator(".idea-card")).toHaveCount(1);
  await page.locator(".idea-main").click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("link", { name: "Άνοιγμα χάρτη" }),
  ).toHaveAttribute("href", "https://example.test/map");
  await expect(
    dialog.getByRole("link", { name: "Πληροφορίες / κράτηση" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await expect(dialog.getByText("1–2 hours", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("img", {
      name: "Synthetic riverside garden",
      exact: true,
    }),
  ).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(
    dialog.getByRole("img", {
      name: "Synthetic riverside garden",
      exact: true,
    }),
  ).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("rich-place.png"),
    fullPage: true,
  });
});

test("imported facts are readable and rich edits preserve sources and original metadata", async ({
  page,
}) => {
  const state = await installFixture(page, {
    signedIn: true,
    withGroup: true,
    withTrip: true,
    memberRole: "member",
  });
  const original = {
    legacy_record: {
      city: "Synthetic district",
      hours: 2,
      costMin: 0,
      costMax: 0,
      costStatus: "Unknown",
      costNote: "Confirm locally",
    },
    sources: [
      {
        reference: "s1",
        source: {
          title: "Synthetic official guide",
          url: "https://example.test/guide",
          checked: "2025-01-01",
        },
      },
    ],
    extra: { retained: true },
  };
  state.activities = [
    {
      id: "66666666-6666-4666-8666-666666666666",
      title: "Synthetic museum",
      description: "Museum details",
      trip_id: TRIP_ID,
      stop_id: null,
      created_by: USER_ID,
      version: 1,
      details: original,
    },
  ];
  await page.goto(`/?group=${GROUP_ID}&trip=${TRIP_ID}`);
  await page.locator(".idea-main").click();
  await expect(
    page.getByRole("dialog").getByText("2 ώρες", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Synthetic official guide", exact: true }),
  ).toHaveAttribute("href", "https://example.test/guide");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Επεξεργασία Synthetic museum", exact: true })
    .click();
  await expect(
    page.getByLabel("Τοποθεσία / διεύθυνση", { exact: true }),
  ).toHaveValue("Synthetic district");
  await expect(
    page.getByLabel("Ώρες λειτουργίας", { exact: true }),
  ).toHaveValue("");
  await page.getByLabel("Τοποθεσία / διεύθυνση", { exact: true }).fill("");
  await page
    .getByLabel("Σύνδεσμος χάρτη", { exact: true })
    .fill("https://example.test/new-map");
  await page.getByRole("button", { name: "Αποθήκευση", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = state.activities[0].details as typeof original & {
    presentation: Record<string, string>;
  };
  expect(saved.legacy_record).toEqual(original.legacy_record);
  expect(saved.sources).toEqual(original.sources);
  expect(saved.extra).toEqual(original.extra);
  await page
    .getByRole("button", { name: "Επεξεργασία Synthetic museum", exact: true })
    .click();
  await expect(
    page.getByLabel("Τοποθεσία / διεύθυνση", { exact: true }),
  ).toHaveValue("");
  await expect(page.getByLabel("Σύνδεσμος χάρτη", { exact: true })).toHaveValue(
    "https://example.test/new-map",
  );
});
