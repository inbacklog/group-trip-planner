import { expect, test } from "@playwright/test";
import { installFixture } from "./fixture";

test("Google is available on login and signup without replacing email or password recovery", async ({ page }) => {
  const state = await installFixture(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Συνέχεια με Google", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Δημιούργησε λογαριασμό" }).click();
  await expect(page.getByRole("button", { name: "Συνέχεια με Google", exact: true })).toBeVisible();
  await expect(page.getByLabel("Κωδικός", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Συνδέσου", exact: true }).click();
  await page.getByRole("button", { name: "Ξέχασες τον κωδικό;" }).click();
  await expect(page.getByRole("button", { name: "Συνέχεια με Google", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Αποστολή συνδέσμου", exact: true })).toBeVisible();
  expect(state.mutations).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Google uses PKCE and a clean callback while a pending invite survives the redirect", async ({ page, baseURL }) => {
  const state = await installFixture(page);
  const invite = "synthetic-google-invite";
  let authorization: URL | undefined;
  await page.route("https://synthetic.supabase.co/auth/v1/authorize**", async route => {
    authorization = new URL(route.request().url());
    await route.fulfill({ status: 302, headers: { location: `${baseURL}/?code=synthetic-google-code` } });
  });
  await page.goto(`/#invite=${invite}`);
  await expect(page.getByText(/Έχεις μια πρόσκληση/)).toBeVisible();
  await page.getByRole("button", { name: "Συνέχεια με Google", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Η παρέα σε περιμένει" })).toBeVisible();
  expect(authorization?.searchParams.get("provider")).toBe("google");
  expect(authorization?.searchParams.get("redirect_to")).toBe(`${baseURL}/`);
  expect(authorization?.searchParams.get("code_challenge_method")).toBe("s256");
  expect(authorization?.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(authorization?.searchParams.get("prompt")).toBe("select_account");
  expect(authorization?.href).not.toContain(invite);
  expect(authorization?.searchParams.get("scopes") ?? "").not.toMatch(/gmail|drive|calendar/i);
  const exchange = state.mutations.find(m => m.path.endsWith("/auth/v1/token"));
  expect(exchange?.body.auth_code).toBe("synthetic-google-code");
  expect(exchange?.body.code_verifier).toBeTruthy();
  expect(state.mutations.some(m => m.path.includes("/rpc/"))).toBe(false);
  expect(await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite"))).toBe(invite);
  expect(new URL(page.url()).searchParams.has("code")).toBe(false);
});

test("cancelled Google consent returns a clear error and preserves the invite for retry", async ({ page, baseURL }) => {
  const state = await installFixture(page);
  await page.route("https://synthetic.supabase.co/auth/v1/authorize**", route => route.fulfill({
    status: 302,
    headers: { location: `${baseURL}/?error=access_denied&error_description=synthetic-cancelled-consent` },
  }));
  await page.goto("/#invite=synthetic-retry-invite");
  await page.getByRole("button", { name: "Συνέχεια με Google", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Η σύνδεση με Google ακυρώθηκε");
  await expect(page.getByRole("button", { name: "Συνέχεια με Google", exact: true })).toBeEnabled();
  await expect(page.getByText(/Έχεις μια πρόσκληση/)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite"))).toBe("synthetic-retry-invite");
  expect(new URL(page.url()).searchParams.has("error")).toBe(false);
  expect(state.mutations).toHaveLength(0);
});
