import { checkLayout, expect, test } from "./fixtures";

const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
const storageKey = "lulu-cart-v2:https://api.lulu.test";
const user = {
  id: "admin",
  name: "Smoke admin",
  email: "smoke@example.test",
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const verifiedSession = {
  user,
  session: {
    id: "smoke-session",
    userId: user.id,
    token: "fixture",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

test("password sign-in claims the selected guest bag for the verified account and resumes the local destination", async ({
  page,
  api,
}) => {
  api.responses.set("GET /api/auth/get-session", { body: null });
  api.responses.set(`GET /cart/${cartId}`, { body: { items: [], total: 0 } });
  api.responses.set(`POST /cart/${cartId}/claim`, {
    body: { message: "Cart claimed", ownerId: user.id },
  });
  api.responses.set("GET /v2/colors", { body: { success: true, data: [] } });
  await page.addInitScript(
    ({ key, id }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          cartId: id,
          guestToken: id,
          ownerId: null,
          pending: false,
          revision: crypto.randomUUID(),
        }),
      );
    },
    { key: storageKey, id: cartId },
  );
  await page.goto("/signin?returnTo=%2Fproducts%2F1");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("controlled smoke password");
  api.responses.set("POST /api/auth/sign-in/email", {
    body: { user, token: "fixture", redirect: false },
  });
  api.responses.set("GET /api/auth/get-session", { body: verifiedSession });
  const claim = page.waitForRequest((request) =>
    request.url().endsWith(`/cart/${cartId}/claim`),
  );
  await page.getByRole("button", { name: "Sign in with password" }).click();
  const claimRequest = await claim;
  expect(claimRequest.postDataJSON()).toEqual({ expectedUserId: user.id });
  expect(claimRequest.headers()["x-cart-token"]).toBe(cartId);
  await expect(page).toHaveURL(/\/products\/1$/);
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    storageKey,
  );
  expect(saved).toMatchObject({ cartId, ownerId: user.id });
  expect(saved.guestToken).toBeUndefined();
  await checkLayout(page);
});

test("an expired owned-cart read revalidates the session and preserves the bag for sign-in", async ({
  page,
  api,
}) => {
  api.responses.set(`GET /cart/${cartId}`, { body: { items: [], total: 0 } });
  await page.addInitScript(
    ({ key, id }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          cartId: id,
          ownerId: "admin",
          pending: false,
          revision: crypto.randomUUID(),
        }),
      );
    },
    { key: storageKey, id: cartId },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Bag (0)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh bag" })).toBeEnabled();
  api.responses.set("GET /api/auth/get-session", { body: null });
  api.responses.set(`GET /cart/${cartId}`, {
    status: 404,
    body: { error: "Cart not found" },
  });
  await page.getByRole("button", { name: "Refresh bag" }).click();
  await expect
    .poll(
      () =>
        api.requests.filter((key) => key === "GET /api/auth/get-session")
          .length,
    )
    .toBeGreaterThan(1);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in with password" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      storageKey,
    ),
  ).toMatchObject({ cartId, ownerId: "admin" });
  await expect(page).toHaveURL(/\/signin\?returnTo=%2F$/);
});
