import { test, expect } from "@playwright/test";
import { installFixture, GROUP_ID } from "./fixture";

test("member chooses a group display name without changing identity or role", async ({
  page,
}) => {
  const state = await installFixture(page, {
    signedIn: true,
    withGroup: true,
    memberRole: "member",
  });
  await page.goto(`/?group=${GROUP_ID}`);
  await page.getByRole("button", { name: /^Μέλη/ }).click();
  await page
    .getByLabel("Το όνομά σου στην παρέα", { exact: true })
    .fill("Synthetic Traveller");
  await page
    .getByRole("button", { name: "Αποθήκευση ονόματος", exact: true })
    .click();
  await expect(page.locator(".member-row strong")).toHaveText(
    "Synthetic Traveller",
  );
  expect(state.mutations.map((entry) => entry.path)).toEqual([
    "/rest/v1/rpc/set_member_display_name",
  ]);
  expect(state.mutations[0].body).toEqual({
    p_group_id: GROUP_ID,
    p_display_name: "Synthetic Traveller",
  });
  await expect(page.locator(".member-row .role-badge")).toHaveText("Μέλος");
});
