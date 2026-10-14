import { checkLayout, deferred, expect, test } from "./fixtures";

const cartId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const line = {
  id: 1,
  productId: "PART",
  name: "Bracket",
  quantity: 2,
  color: "Black",
  filamentType: "PLA",
  filamentId: cartId,
  price: 1.23,
};

const quote = {
  id: quoteId,
  cartId,
  currency: "USD",
  createdAt: Date.now(),
  expiresAt: Date.now() + 900000,
  status: "valid",
  address: {
    name: "Smoke Admin",
    line1: "123 Example Avenue",
    line2: "",
    city: "Portland",
    state: "OR",
    zip: "97201",
    country: "US",
  },
  lines: [
    {
      cartItemId: 1,
      name: line.name,
      skuNumber: "PART",
      quantity: 2,
      color: line.color,
      filamentId: cartId,
      filamentType: "PLA",
      unitAmountCents: 123,
      totalAmountCents: 246,
    },
  ],
  subtotalCents: 246,
  shippingCents: 113,
  totalCents: 359,
};

test("reviews shipping on production assets and invalidates when the address changes", async ({
  page,
  api,
}) => {
  await page.addInitScript(
    ({ cartId, quoteId }) =>
      localStorage.setItem(
        "lulu-cart-v2:https://api.lulu.test",
        JSON.stringify({
          cartId,
          ownerId: "admin",
          pending: false,
          revision: quoteId,
        }),
      ),
    { cartId, quoteId },
  );
  api.responses.set(`GET /cart/${cartId}`, {
    body: { items: [line], total: 2.46 },
  });
  api.responses.set(`POST /cart/${cartId}/quotes`, { body: quote });
  api.responses.set(`GET /cart/${cartId}/quotes/${quoteId}`, { body: quote });
  await page.goto("/checkout");
  await expect(
    page.getByRole("heading", { name: "Shipping and checkout review" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request a fresh quote" }).click();
  await expect(page.getByText("$3.59", { exact: true })).toBeVisible();
  await expect(page.getByText("$1.13")).toBeVisible();
  await expect(page.getByText(/Bracket · 2 ×/)).toContainText("Black");
  await expect(page.getByText(/Ship to:/)).toContainText("123 Example Avenue");
  await expect(
    page.getByText(/Continue to Square to enter payment details/),
  ).toBeVisible();
  await page.getByLabel("City").fill("Salem");
  await expect(page.getByText("Total (USD)")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Request a fresh quote" }),
  ).toBeDisabled();
  await expect(
    page.getByAltText("Lulu the dog with a racing badge"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Return to your bag" }).focus();
  await expect(
    page.getByRole("link", { name: "Return to your bag" }),
  ).toBeFocused();
  await page.screenshot({
    path: `artifacts/smoke/checkout-${test.info().project.name}.png`,
    fullPage: true,
  });
});

for (const denial of ["cart", "quote", "profile"] as const) {
  test(`checkout revalidates the session after ${denial} authorization expires`, async ({
    page,
    api,
  }) => {
    await page.addInitScript(
      ({ cartId, quoteId }) =>
        localStorage.setItem(
          "lulu-cart-v2:https://api.lulu.test",
          JSON.stringify({
            cartId,
            ownerId: "admin",
            pending: false,
            revision: quoteId,
          }),
        ),
      { cartId, quoteId },
    );
    api.responses.set(`GET /cart/${cartId}`, {
      body: { items: [line], total: 2.46 },
    });
    await page.goto("/checkout");
    await expect(
      page.getByRole("button", { name: "Request a fresh quote" }),
    ).toBeEnabled();
    const sessionReads = api.requests.filter(
      (key) => key === "GET /api/auth/get-session",
    ).length;
    api.responses.set("GET /api/auth/get-session", { body: null });
    if (denial === "quote") {
      api.responses.set(`POST /cart/${cartId}/quotes`, {
        status: 401,
        body: { error: "Unauthorized" },
      });
      await page.getByRole("button", { name: "Request a fresh quote" }).click();
    } else if (denial === "profile") {
      api.responses.set("POST /profile/admin", {
        status: 403,
        body: { error: "Unauthorized" },
      });
      await page.getByLabel("City").fill("Salem");
      await page.getByRole("button", { name: "Save profile" }).click();
    } else {
      api.responses.set(`GET /cart/${cartId}`, {
        status: 404,
        body: { error: "Cart not found" },
      });
      await page.evaluate(() =>
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "lulu-cart-v2:https://api.lulu.test",
          }),
        ),
      );
    }
    await expect(
      page.getByRole("link", { name: "Sign in to review your checkout" }),
    ).toBeVisible();
    expect(
      api.requests.filter((key) => key === "GET /api/auth/get-session").length,
    ).toBeGreaterThan(sessionReads);
    expect(
      await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("lulu-cart-v2:https://api.lulu.test") ?? "null",
        ),
      ),
    ).toMatchObject({ cartId, ownerId: "admin" });
    await expect(page.getByText("Total (USD)")).toHaveCount(0);
  });
}

test("Square checkout preserves its identity through a request timeout, reload and explicit retry", async ({
  page,
  api,
}) => {
  test.setTimeout(45_000);
  const storageKey = "lulu-checkout-v1:https://api.lulu.test:admin";
  await page.addInitScript(
    ({ cartId, quoteId }) =>
      localStorage.setItem(
        "lulu-cart-v2:https://api.lulu.test",
        JSON.stringify({
          cartId,
          ownerId: "admin",
          pending: false,
          revision: quoteId,
        }),
      ),
    { cartId, quoteId },
  );
  api.responses.set(`GET /cart/${cartId}`, {
    body: { items: [line], total: 2.46 },
  });
  api.responses.set(`POST /cart/${cartId}/quotes`, { body: quote });
  api.responses.set(`GET /cart/${cartId}/quotes/${quoteId}`, { body: quote });
  const lost = deferred<{ status: number; body: unknown }>();
  const submissions: { quoteId: string; requestKey: string }[] = [];
  const outcome = {
    attemptId: "33333333-3333-4333-8333-333333333333",
    quoteId,
    cartId,
    state: "unknown",
    paymentUrl: null as string | null,
    order: null as unknown,
  };
  await page.route(`**/cart/${cartId}/checkout`, async (route) => {
    const body = route.request().postDataJSON();
    submissions.push(body);
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      storageKey,
    );
    expect(stored).toEqual({ ...body, cartId });
    expect(Object.keys(body).sort()).toEqual(["quoteId", "requestKey"]);
    expect(route.request().method()).toBe("POST");
    const statusKey = `GET /checkout-attempts/by-request-key/${body.requestKey}`;
    if (submissions.length === 1) {
      api.responses.set(`POST /cart/${cartId}/checkout`, lost.promise);
      api.responses.set(statusKey, { body: outcome });
    } else {
      outcome.state = "pending";
      outcome.paymentUrl = "https://square.link/u/fixture";
      api.responses.set(statusKey, { body: outcome });
      api.responses.set(`POST /cart/${cartId}/checkout`, {
        body: {
          attemptId: outcome.attemptId,
          quoteId,
          state: "initiating",
          paymentUrl: outcome.paymentUrl,
          squareOrderId: "square-order",
        },
      });
    }
    await route.fallback();
  });
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Request a fresh quote" }).click();
  const confirm = page.getByRole("button", {
    name: "Continue to Square — $3.59 USD",
  });
  const submittedAt = Date.now();
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await expect(page.getByText(/Contacting Square checkout/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry this same checkout" }),
  ).toBeEnabled({ timeout: 25_000 });
  expect(Date.now() - submittedAt).toBeGreaterThanOrEqual(19_000);
  lost.resolve({ status: 502, body: { error: "Acknowledgement unavailable" } });
  expect(submissions).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry this same checkout" }),
  ).toBeEnabled();
  expect(submissions).toHaveLength(1);
  await page.getByRole("button", { name: "Retry this same checkout" }).click();
  await expect(
    page.getByRole("link", { name: "Continue this checkout with Square" }),
  ).toHaveAttribute("href", "https://square.link/u/fixture");
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  outcome.state = "paid";
  outcome.paymentUrl = null;
  outcome.order = {
    id: 12,
    paymentStatus: "paid",
    fulfillmentState: "failed",
    status: "paid_fulfillment_failed",
  };
  api.responses.set(`GET /cart/${cartId}`, { body: { items: [], total: 0 } });
  await page.reload();
  await expect(page.getByText(/Payment confirmed/)).toBeVisible();
  await expect(page.getByText(/Fulfillment: failed/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View this order" }),
  ).toHaveAttribute("href", "/orders/12");
  await expect(
    page.getByRole("link", { name: "Continue this checkout with Square" }),
  ).toHaveCount(0);
  expect(submissions).toHaveLength(2);
  await checkLayout(page);
  await page.getByRole("button", { name: "Check payment outcome" }).focus();
  await expect(
    page.getByRole("button", { name: "Check payment outcome" }),
  ).toBeFocused();
});

test("two tabs serialize simultaneous confirmations with native browser locks", async ({
  page,
  api,
}) => {
  const storageKey = "lulu-checkout-v1:https://api.lulu.test:admin";
  await page.addInitScript(
    ({ cartId, quoteId }) =>
      localStorage.setItem(
        "lulu-cart-v2:https://api.lulu.test",
        JSON.stringify({
          cartId,
          ownerId: "admin",
          pending: false,
          revision: quoteId,
        }),
      ),
    { cartId, quoteId },
  );
  api.responses.set(`GET /cart/${cartId}`, {
    body: { items: [line], total: 2.46 },
  });
  api.responses.set(`POST /cart/${cartId}/quotes`, { body: quote });
  api.responses.set(`GET /cart/${cartId}/quotes/${quoteId}`, { body: quote });
  const session = page.waitForResponse(
    "https://api.lulu.test/api/auth/get-session",
  );
  const profile = page.waitForResponse("https://api.lulu.test/profile");
  await page.goto("/checkout");
  api.responses.set("GET /api/auth/get-session", {
    body: await (await session).json(),
  });
  api.responses.set("GET /profile", { body: await (await profile).json() });
  const acknowledgement = deferred<{ body: unknown }>();
  api.responses.set(`POST /cart/${cartId}/checkout`, acknowledgement.promise);
  const submissions: { quoteId: string; requestKey: string }[] = [];
  function submitted(body: { quoteId: string; requestKey: string }) {
    submissions.push(body);
    api.responses.set(
      `GET /checkout-attempts/by-request-key/${body.requestKey}`,
      {
        body: {
          attemptId: "33333333-3333-4333-8333-333333333333",
          quoteId,
          cartId,
          state: "pending",
          paymentUrl: "https://square.link/u/fixture",
          order: null,
        },
      },
    );
  }
  await page.route(`**/cart/${cartId}/checkout`, async (route) => {
    submitted(route.request().postDataJSON());
    await route.fallback();
  });
  const second = await page.context().newPage();
  const errors: string[] = [];
  second.on("pageerror", (error) => errors.push(error.message));
  second.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await second.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:4173") return route.continue();
    const key = `${request.method()} ${url.pathname}`;
    if (url.origin !== "https://api.lulu.test" || !api.responses.has(key)) {
      errors.push(`Unexpected second-tab request: ${request.url()}`);
      return route.abort();
    }
    api.requests.push(key);
    if (key === `POST /cart/${cartId}/checkout`)
      submitted(request.postDataJSON());
    const reply = await api.responses.get(key);
    await route.fulfill({ status: reply?.status ?? 200, json: reply?.body });
  });
  try {
    await second.goto("/checkout");
    for (const tab of [page, second]) {
      await tab.getByRole("button", { name: "Request a fresh quote" }).click();
      await expect(
        tab.getByRole("button", { name: "Continue to Square — $3.59 USD" }),
      ).toBeEnabled();
    }
    // Hold the actual browser lock so both tabs queue before either persists an identity.
    await page.evaluate(
      (key) =>
        new Promise<void>((acquired) => {
          void navigator.locks.request(key, async () => {
            const released = new Promise<void>((release) =>
              window.addEventListener(
                "release-checkout-test-lock",
                () => release(),
                { once: true },
              ),
            );
            acquired();
            await released;
          });
        }),
      storageKey,
    );
    await Promise.all(
      [page, second].map((tab) =>
        tab
          .getByRole("button", { name: "Continue to Square — $3.59 USD" })
          .click(),
      ),
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (key) =>
            (await navigator.locks.query()).pending?.filter(
              (lock) => lock.name === key,
            ).length,
          storageKey,
        ),
      )
      .toBe(2);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("release-checkout-test-lock")),
    );
    await expect.poll(() => submissions.length).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(
          async (key) =>
            (await navigator.locks.query()).pending?.filter(
              (lock) => lock.name === key,
            ).length,
          storageKey,
        ),
      )
      .toBe(1);
    const identity = await page.evaluate(
      (key) => localStorage.getItem(key),
      storageKey,
    );
    expect(JSON.parse(identity ?? "null")).toEqual({
      ...submissions[0],
      cartId,
    });
    acknowledgement.resolve({
      body: {
        attemptId: "33333333-3333-4333-8333-333333333333",
        quoteId,
        state: "initiating",
        paymentUrl: "https://square.link/u/fixture",
        squareOrderId: "square-order",
      },
    });
    for (const tab of [page, second]) {
      await expect(
        tab.getByRole("link", { name: "Continue this checkout with Square" }),
      ).toBeVisible();
      expect(
        await tab.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
          storageKey,
        ),
      ).toEqual(JSON.parse(identity ?? "null"));
    }
    expect(submissions).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await second.close();
  }
});
