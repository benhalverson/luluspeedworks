import { expect, test } from "./fixtures";

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
  api.responses.set(`POST /cart/${cartId}/quotes`, { body: quote });
  api.responses.set(`GET /cart/${cartId}/quotes/${quoteId}`, { body: quote });
  await page.goto("/checkout");
  await expect(
    page.getByRole("heading", { name: "Shipping and checkout review" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request a fresh quote" }).click();
  await expect(page.getByText("$3.59")).toBeVisible();
  await expect(page.getByText("$1.13")).toBeVisible();
  await expect(page.getByText(/Bracket · 2 ×/)).toContainText("Black");
  await expect(page.getByText(/Ship to:/)).toContainText("123 Example Avenue");
  await expect(page.getByText(/Payment is not available yet/)).toBeVisible();
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
