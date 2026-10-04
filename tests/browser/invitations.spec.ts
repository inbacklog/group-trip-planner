import { expect, test, type Page } from "@playwright/test";
import { GROUP_ID, installFixture } from "./fixture";

async function openSameDocumentInvitation(page: Page, token: string) {
  // A link differing only by #invite does not reload an already-open app.
  // Keep a document marker so this test cannot pass through a fresh startup.
  await page.evaluate((value) => {
    document.documentElement.dataset.invitationDocument = "already-open";
    location.hash = new URLSearchParams({ invite: value }).toString();
  }, token);
}

async function expectCapturedInvitation(page: Page, token: string) {
  await expect(page.locator("html")).toHaveAttribute(
    "data-invitation-document",
    "already-open",
  );
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(
    await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
  ).toBe(token);
}

test("an already signed-in member sees a same-tab invitation without reloading or automatic acceptance", async ({
  page,
}) => {
  const state = await installFixture(page, { signedIn: true });
  const token = "synthetic-same-tab-member-invite";
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Πού πάμε μετά;" }),
  ).toBeVisible();
  await openSameDocumentInvitation(page, token);

  await expect(
    page.getByRole("heading", { name: "Η παρέα σε περιμένει" }),
  ).toBeVisible();
  await expectCapturedInvitation(page, token);
  expect(state.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Αποδοχή", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Συνθετική παρέα", exact: true }),
  ).toBeVisible();
  expect(state.mutations).toEqual([
    { path: "/rest/v1/rpc/accept_invitation", body: { p_token: token } },
  ]);
  expect(new URL(page.url()).searchParams.get("group")).toBe(GROUP_ID);
  expect(
    await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
  ).toBeNull();
});

test("a signed-out same-tab invitation survives Google PKCE and waits for acceptance after the callback", async ({
  page,
  baseURL,
}) => {
  const state = await installFixture(page);
  const token = "synthetic-same-tab-google-invite";
  let authorization: URL | undefined;
  await page.route(
    "https://synthetic.supabase.co/auth/v1/authorize**",
    async (route) => {
      authorization = new URL(route.request().url());
      await route.fulfill({
        status: 302,
        headers: {
          location: `${baseURL}/?code=synthetic-same-tab-google-code`,
        },
      });
    },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Καλώς ήρθες ξανά", exact: true }),
  ).toBeVisible();
  await openSameDocumentInvitation(page, token);

  await expect(
    page.getByText("Έχεις μια πρόσκληση. Συνδέσου για να την αποδεχτείς."),
  ).toBeVisible();
  await expectCapturedInvitation(page, token);
  expect(state.mutations).toHaveLength(0);
  await page
    .getByRole("button", { name: "Συνέχεια με Google", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Η παρέα σε περιμένει" }),
  ).toBeVisible();
  expect(authorization?.searchParams.get("redirect_to")).toBe(`${baseURL}/`);
  expect(authorization?.searchParams.get("code_challenge_method")).toBe("s256");
  expect(authorization?.href).not.toContain(token);
  const exchange = state.mutations.find((mutation) =>
    mutation.path.endsWith("/auth/v1/token"),
  );
  expect(exchange?.body.auth_code).toBe("synthetic-same-tab-google-code");
  expect(exchange?.body.code_verifier).toBeTruthy();
  expect(
    state.mutations.filter((mutation) => mutation.path.includes("/rpc/")),
  ).toHaveLength(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
  ).toBe(token);
  await page.getByRole("button", { name: "Αποδοχή", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Συνθετική παρέα", exact: true }),
  ).toBeVisible();
  expect(
    state.mutations.filter((mutation) => mutation.path.includes("/rpc/")),
  ).toEqual([
    { path: "/rest/v1/rpc/accept_invitation", body: { p_token: token } },
  ]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
  ).toBeNull();
});

test("an unavailable invitation produces visible feedback and is cleared without revealing group content", async ({
  page,
}) => {
  const state = await installFixture(page, { signedIn: true });
  const token = "synthetic-expired-invitation";
  let attempts = 0;
  await page.route("**/rest/v1/rpc/accept_invitation", async (route) => {
    attempts += 1;
    expect(route.request().postDataJSON()).toEqual({ p_token: token });
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: "22023",
        message: "Invitation unavailable",
      }),
    });
  });
  await page.goto(`/#invite=${token}`);
  await page.getByRole("button", { name: "Αποδοχή", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    /πρόσκληση.*(λήξει|χρησιμοποιηθεί)/i,
  );
  await expect(
    page.getByRole("heading", { name: "Συνθετική παρέα", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Αποδοχή", exact: true }),
  ).toHaveCount(0);
  expect(attempts).toBe(1);
  expect(state.groups).toHaveLength(0);
  expect(state.mutations).toHaveLength(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
  ).toBeNull();
  expect(page.url()).not.toContain(token);
});

test("a signed-in fresh startup still captures and explicitly accepts an invitation once", async ({
  page,
}) => {
  const state = await installFixture(page, { signedIn: true });
  const token = "synthetic-startup-invitation";
  await page.goto(`/#invite=${token}`);
  await expect(
    page.getByRole("heading", { name: "Η παρέα σε περιμένει" }),
  ).toBeVisible();
  expect(page.url()).not.toContain(token);
  expect(state.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Αποδοχή", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Συνθετική παρέα", exact: true }),
  ).toBeVisible();
  expect(state.mutations).toEqual([
    { path: "/rest/v1/rpc/accept_invitation", body: { p_token: token } },
  ]);
  await expect(
    page.getByRole("button", { name: "Αποδοχή", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
  ).toBeNull();
});

for (const firstResult of ["success", "unavailable"] as const) {
  test(`a newer invitation survives an older acceptance finishing with ${firstResult}`, async ({
    page,
  }) => {
    await installFixture(page, { signedIn: true });
    const firstToken = "synthetic-inflight-first-invite";
    const secondToken = "synthetic-inflight-second-invite";
    const attempts: string[] = [];
    let finishFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    await page.route("**/rest/v1/rpc/accept_invitation", async (route) => {
      const token = route.request().postDataJSON().p_token;
      attempts.push(token);
      if (token === firstToken) {
        await firstResponse;
        if (firstResult === "unavailable") {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              code: "22023",
              message: "Invitation unavailable",
            }),
          });
        }
      }
      return route.fallback();
    });
    try {
      await page.goto(`/#invite=${firstToken}`);
      const accept = page.getByRole("button", { name: "Αποδοχή", exact: true });
      await accept.click();
      await expect.poll(() => attempts).toEqual([firstToken]);
      await expect(accept).toBeDisabled();
      await openSameDocumentInvitation(page, secondToken);
      await expectCapturedInvitation(page, secondToken);

      finishFirst();
      await expect(accept).toBeEnabled();
      await expect(
        page.getByRole("heading", { name: "Η παρέα σε περιμένει" }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(
        await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
      ).toBe(secondToken);
      await accept.click();
      await expect(
        page.getByRole("heading", { name: "Συνθετική παρέα", exact: true }),
      ).toBeVisible();
      await expect(accept).toHaveCount(0);
      expect(attempts).toEqual([firstToken, secondToken]);
      expect(
        await page.evaluate(() => sessionStorage.getItem("gtp.pending-invite")),
      ).toBeNull();
    } finally {
      finishFirst();
    }
  });
}

test("blocked session storage still allows an already signed-in user to accept in the current document", async ({
  page,
}) => {
  const state = await installFixture(page, { signedIn: true });
  await page.addInitScript(() => {
    const storage = sessionStorage;
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      Object.defineProperty(storage, method, {
        value: () => {
          throw new DOMException(
            "Storage blocked for synthetic test",
            "SecurityError",
          );
        },
      });
    }
  });
  const token = "synthetic-memory-only-invitation";
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Πού πάμε μετά;" }),
  ).toBeVisible();
  await openSameDocumentInvitation(page, token);
  await expect(
    page.getByRole("heading", { name: "Η παρέα σε περιμένει" }),
  ).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(state.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Αποδοχή", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Συνθετική παρέα", exact: true }),
  ).toBeVisible();
  expect(state.mutations).toEqual([
    { path: "/rest/v1/rpc/accept_invitation", body: { p_token: token } },
  ]);
});
