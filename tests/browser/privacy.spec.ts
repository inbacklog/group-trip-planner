import { expect, test } from "@playwright/test";
import { installFixture } from "./fixture";

test("public privacy notice is linked before login and reads without authentication or third-party scripts", async ({
  page,
}, testInfo) => {
  const state = await installFixture(page);
  await page.goto("/");
  await page
    .getByRole("link", { name: "Πολιτική απορρήτου", exact: true })
    .click();
  await expect(page).toHaveURL(/\/privacy\.html$/);
  await expect(
    page.getByRole("heading", { name: "Πολιτική απορρήτου", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "el");
  await expect(
    page.getByRole("navigation", { name: "Ενότητες πολιτικής απορρήτου" }),
  ).toBeVisible();
  await expect(page.locator("script")).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(
    page.getByText(/Δεν υπάρχει ακόμη κουμπί διαγραφής λογαριασμού/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "ανοίξεις ένα γενικό αίτημα επικοινωνίας στο αποθετήριο",
    }),
  ).toHaveAttribute(
    "href",
    "https://github.com/inbacklog/group-trip-planner/issues/new",
  );
  expect(state.mutations).toHaveLength(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("public-privacy.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Επιστροφή στην εφαρμογή", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Καλώς ήρθες ξανά", exact: true }),
  ).toBeVisible();
});

test("signed-in footer retains a public privacy link without exposing private routing parameters", async ({
  page,
}) => {
  await installFixture(page, { signedIn: true });
  await page.goto("/?group=synthetic-private-group");
  const link = page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Πολιτική απορρήτου", exact: true });
  await expect(link).toHaveAttribute("href", "/privacy.html");
  await link.click();
  await expect(page).toHaveURL(/\/privacy\.html$/);
  expect(new URL(page.url()).search).toBe("");
  await expect(
    page.getByRole("heading", { name: "Πολιτική απορρήτου", exact: true }),
  ).toBeVisible();
});
