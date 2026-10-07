import { order, orderPage } from "../order-fixtures";
import { checkLayout, deferred, expect, test } from "./fixtures";

test("owned order history separates paid evidence from failed fulfillment and supports retry and reload", async ({
  page,
  api,
}) => {
  page.on("request", (request) => {
    if (
      new URL(request.url()).origin === "https://api.lulu.test" &&
      request.method() === "GET" &&
      new URL(request.url()).pathname.startsWith("/orders")
    )
      expect(request.headers()["x-expected-account-id"]).toBe("admin");
  });
  const paid = {
    ...order,
    accountId: "admin",
    status: "paid_fulfillment_failed",
    paymentStatus: "paid",
    fulfillmentState: "process_unknown",
  };
  api.responses.set("GET /orders", {
    body: { ...orderPage, accountId: "admin", orders: [paid] },
  });
  api.responses.set("GET /orders/1", {
    status: 503,
    body: { error: "Unavailable" },
  });
  await page.goto("/profile");
  await page.getByRole("link", { name: "Your orders", exact: true }).click();
  await page.getByRole("link", { name: "Order LULU-001" }).click();
  await expect(page.getByText(/Orders unavailable/)).toBeVisible();
  api.responses.set("GET /orders/1", { body: paid });
  await page.getByRole("button", { name: "Retry orders" }).click();
  await expect(page.getByText("Payment: paid")).toBeVisible();
  await expect(
    page.getByText(/Payment received; fulfillment needs attention/),
  ).toBeVisible();
  await expect(
    page.getByText("Fulfillment: Production submission needs verification"),
  ).toBeVisible();
  await expect(page.getByText("$32.99")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Order LULU-001" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Track shipment" }),
  ).toHaveAttribute("href", order.fulfillment.trackingUrl);
  await page.getByRole("link", { name: "Back to orders" }).click();
  await expect(
    page.getByRole("link", { name: "Order LULU-001" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await checkLayout(page);
  api.responses.set("GET /api/auth/get-session", { body: null });
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Sign in to view your orders" }),
  ).toBeVisible();
  await expect(page.getByText("$32.99")).toHaveCount(0);
});

test("rejects another account's empty order history", async ({ page, api }) => {
  api.responses.set("GET /orders", {
    body: {
      accountId: "other-account",
      orders: [],
      pagination: { limit: 10, offset: 0, count: 0 },
    },
  });
  await page.goto("/orders");
  await expect(page.getByText(/Orders unavailable/)).toBeVisible();
  await expect(page.getByText("No orders on this page.")).toHaveCount(0);
  await expect
    .poll(
      () =>
        api.requests.filter((key) => key === "GET /api/auth/get-session")
          .length,
    )
    .toBeGreaterThan(1);
});

test("a held order response cannot cross accounts before session refresh", async ({
  page,
  api,
}) => {
  const held = deferred<{ body: unknown }>();
  api.responses.set("GET /orders", held.promise);
  const accounts: (string | undefined)[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).origin === "https://api.lulu.test" &&
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/orders"
    )
      accounts.push(request.headers()["x-expected-account-id"]);
  });
  await page.goto("/orders");
  await expect(page.getByText("Loading your orders…")).toBeVisible();
  await page.evaluate(() => {
    const target = document.body;
    target.dataset.privateLeak = "false";
    new MutationObserver(() => {
      if (target.textContent?.includes("OTHER-ACCOUNT-PRIVATE"))
        target.dataset.privateLeak = "true";
    }).observe(target, { childList: true, subtree: true, characterData: true });
  });
  api.responses.set("GET /api/auth/get-session", {
    body: {
      user: {
        id: "bob",
        name: "Bob",
        email: "bob@example.test",
        emailVerified: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      session: {
        id: "bob-session",
        userId: "bob",
        token: "fixture",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    },
  });
  api.responses.set("GET /orders", {
    body: {
      accountId: "bob",
      orders: [],
      pagination: { limit: 10, offset: 0, count: 0 },
    },
  });
  held.resolve({
    body: {
      ...orderPage,
      accountId: "bob",
      orders: [
        { ...order, accountId: "bob", orderNumber: "OTHER-ACCOUNT-PRIVATE" },
      ],
    },
  });
  await expect(page.getByText("No orders on this page.")).toBeVisible();
  expect(accounts).toEqual(["admin", "bob"]);
  expect(await page.locator("body").getAttribute("data-private-leak")).toBe(
    "false",
  );
});
