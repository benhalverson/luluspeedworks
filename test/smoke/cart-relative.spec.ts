import { checkLayout, deferred, expect, test } from "./fixtures";

const cartId = "8cfbf30a-2995-486e-a1e8-8f7d41488f1e";
const storageKey = "lulu-cart-v2:https://api.lulu.test";
const line = {
  id: 91,
  productId: "SMOKE-1",
  quantity: 1,
  color: "red",
  filamentType: "PLA",
  filamentId: "76fe1f79-3f1e-43e4-b8f4-61159de5b93c",
  name: "Smoke part",
  price: 2.29,
};

test("queued plus applies to the fresh cart after another tab's change", async ({
  page,
  api,
}) => {
  api.responses.set("GET /api/auth/get-session", { body: null });
  api.responses.set(`GET /cart/${cartId}`, {
    body: { items: [line], total: 2.29 },
  });
  await page.addInitScript(
    ({ key, id }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          cartId: id,
          guestToken: id,
          ownerId: null,
          pending: false,
          revision: crypto.randomUUID(),
        }),
      ),
    { key: storageKey, id: cartId },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Bag (1)", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Increase Smoke part quantity" }),
  ).toBeEnabled();
  await page.evaluate(
    (key) =>
      new Promise<void>((locked) => {
        void navigator.locks.request(
          key,
          () =>
            new Promise<void>((release) => {
              Object.assign(window, { releaseCartLock: release });
              locked();
            }),
        );
      }),
    storageKey,
  );
  await page
    .getByRole("button", { name: "Increase Smoke part quantity" })
    .click();
  api.responses.set(`GET /cart/${cartId}`, {
    body: { items: [{ ...line, quantity: 2 }], total: 4.58 },
  });
  const update = deferred<{ body: unknown }>();
  api.responses.set("PUT /cart/update", update.promise);
  const write = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().endsWith("/cart/update"),
  );
  await page.evaluate(() =>
    (window as unknown as { releaseCartLock: () => void }).releaseCartLock(),
  );
  expect((await write).postDataJSON()).toMatchObject({
    itemId: line.id,
    quantity: 3,
  });
  api.responses.set(`GET /cart/${cartId}`, {
    body: { items: [{ ...line, quantity: 3 }], total: 6.87 },
  });
  update.resolve({ body: { message: "Updated" } });
  await expect(page.getByText(/Quantity: 3/)).toBeVisible();
  await page.keyboard.press("Escape");
  await checkLayout(page);
});
