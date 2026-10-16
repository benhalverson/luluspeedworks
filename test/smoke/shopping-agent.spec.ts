import type { AgentEffect } from "../../src/storefront/agent-commerce";
import { agentFixture } from "../agent-fixtures";
import { order } from "../order-fixtures";
import { checkLayout, deferred, expect, test } from "./fixtures";

function completedAgentStream(
  sessionId: string,
  runId: string,
  uiRevision: number,
  result: AgentEffect,
) {
  const batch = structuredClone(agentFixture);
  for (const product of Object.values(
    batch.messages[0].updateDataModel.value.products,
  ))
    product.image = "";
  return [
    {
      type: "RUN_STARTED",
      threadId: sessionId,
      runId,
      metadata: { uiRevision },
    },
    {
      type: "CUSTOM",
      name: "lulu.progress",
      value: { runId, uiRevision, stage: "admission", invocation: 0 },
    },
    {
      type: "CUSTOM",
      name: "kind" in result ? "lulu.commerce.v1" : "lulu.cart.v1",
      value: { runId, uiRevision, result },
    },
    {
      type: "CUSTOM",
      name: "lulu.a2ui",
      value: { ...batch, runId, uiRevision },
    },
    {
      type: "RUN_FINISHED",
      threadId: sessionId,
      runId,
      result: { uiRevision, status: "completed" },
    },
  ]
    .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
    .join("");
}

for (const reason of [
  "inference_unavailable",
  "budget_exhausted",
  "accounting_unavailable",
]) {
  test(`shopping requests preserve ${reason === "inference_unavailable" ? "A2UI browsing and bag" : "shopping through checkout review"} after ${reason}`, async ({
    page,
    api,
  }) => {
    const cartId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    api.responses.set("POST /cart/create", {
      body: { cartId, ownerId: "admin" },
    });
    api.responses.set(`GET /cart/${cartId}`, { body: { items: [], total: 0 } });
    api.responses.set(`GET /cart/${cartId}/agent-state`, {
      body: { cartId, revision: 0, items: [] },
    });
    const sessionId = "73f4ebed-0967-4112-8484-ed0263749e61";
    const requests: unknown[] = [];
    let fail = false;
    await page.route("https://api.lulu.test/agent/**", async (route) => {
      const request = route.request();
      if (request.url().endsWith("/sessions")) {
        return route.fulfill({
          json: {
            sessionId,
            capability: "test-capability",
            expiresAt: 9e12,
            absoluteExpiresAt: 9e12,
          },
        });
      }
      const input = request.postDataJSON();
      requests.push(input);
      expect(request.headers().authorization).toBe("Bearer test-capability");
      const batch = structuredClone(agentFixture);
      for (const product of Object.values(
        batch.messages[0].updateDataModel.value.products,
      ))
        product.image = "";
      const correlation = { runId: input.runId, uiRevision: input.uiRevision };
      const events = [
        {
          type: "RUN_STARTED",
          threadId: sessionId,
          runId: input.runId,
          metadata: { uiRevision: input.uiRevision },
        },
        {
          type: "CUSTOM",
          name: "lulu.progress",
          value: { ...correlation, stage: "admission", invocation: 0 },
        },
        fail
          ? {
              type: "CUSTOM",
              name: "lulu.fallback",
              value: { ...correlation, reason },
            }
          : {
              type: "CUSTOM",
              name: "lulu.a2ui",
              value: { ...batch, ...correlation },
            },
        {
          type: "RUN_FINISHED",
          threadId: sessionId,
          runId: input.runId,
          result: {
            uiRevision: input.uiRevision,
            status: fail ? "fallback" : "completed",
            ...(fail ? { reason } : {}),
          },
        },
      ];
      await route.fulfill({
        contentType: "text/event-stream",
        body: events
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
    });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Smoke part" })).toBeVisible();
    const input = page.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" });
    await input.fill("Show me pit tools");
    await input.press("Tab");
    await expect(
      page.getByRole("button", { name: "Send shopping request" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Pit tray",
    );
    await expect(
      page.getByRole("link", { name: "Choose this product" }),
    ).toHaveAttribute("href", "/products/1");
    await expect(
      page.getByRole("button", { name: "Add to bag" }),
    ).toBeDisabled();
    await checkLayout(page);
    fail = true;
    await input.fill("What fits my buggy?");
    await input.press("Enter");
    await expect(page.locator("#composer-help")).toContainText(
      reason === "budget_exhausted"
        ? "Shopping guidance has reached its monthly limit"
        : reason === "accounting_unavailable"
          ? "Shopping guidance is temporarily unavailable"
          : "Shopping guidance is unavailable",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Pit tray",
    );
    await expect(input).toHaveValue("What fits my buggy?");
    await page.getByRole("button", { name: "Shop all", exact: true }).click();
    await expect(page.getByRole("link", { name: "Smoke part" })).toBeVisible();
    await page.getByRole("button", { name: "Bag (0)" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Your bag" })).toBeVisible();
    await page.keyboard.press("Escape");
    await checkLayout(page);
    expect(requests).toHaveLength(2);
    expect(
      api.requests.some((key) =>
        /^(POST \/cart\/add|PUT \/cart\/update|DELETE \/cart\/remove)/.test(
          key,
        ),
      ),
    ).toBe(false);
    if (reason === "inference_unavailable") return;

    const filamentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const quoteId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const line = {
      id: 1,
      productId: "SMOKE-1",
      name: "Smoke part",
      quantity: 2,
      color: "red",
      filamentType: "PLA",
      filamentId,
      price: 2.29,
    };
    api.responses.set("GET /v2/colors", {
      body: {
        success: true,
        data: [
          {
            publicId: filamentId,
            name: "Red PLA",
            color: "red",
            profile: "PLA",
            available: true,
          },
        ],
      },
    });
    const writes: { method: string; path: string; body: unknown }[] = [];
    await page.route("https://api.lulu.test/cart/*", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/cart/add" || path === "/cart/update") {
        writes.push({
          method: request.method(),
          path,
          body: request.postDataJSON(),
        });
        const quantity = path === "/cart/add" ? 2 : 3;
        api.responses.set(`GET /cart/${cartId}`, {
          body: {
            items: [{ ...line, quantity }],
            total: quantity === 2 ? 4.58 : 6.87,
          },
        });
      }
      await route.fallback();
    });
    api.responses.set("POST /cart/add", { body: { message: "Added" } });
    api.responses.set("PUT /cart/update", { body: { message: "Updated" } });
    const quote = {
      id: quoteId,
      cartId,
      currency: "USD",
      createdAt: Date.now(),
      expiresAt: Date.now() + 900_000,
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
          cartItemId: line.id,
          name: line.name,
          skuNumber: line.productId,
          quantity: 3,
          color: line.color,
          filamentType: line.filamentType,
          filamentId,
          // Current server prices, distinct from the catalog and bag snapshot.
          unitAmountCents: 250,
          totalAmountCents: 750,
        },
      ],
      subtotalCents: 750,
      shippingCents: 113,
      totalCents: 863,
    };
    api.responses.set(`POST /cart/${cartId}/quotes`, { body: quote });
    api.responses.set(`GET /cart/${cartId}/quotes/${quoteId}`, { body: quote });

    await page.getByRole("link", { name: "Smoke part" }).click();
    await page.getByLabel("Color", { exact: true }).selectOption(filamentId);
    await page.getByLabel("Quantity", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Add to bag" }).click();
    await page.getByRole("button", { name: "Bag (2)", exact: true }).click();
    const bag = page.getByRole("dialog", { name: "Your bag" });
    await expect(bag.getByText(/Quantity: 2/)).toBeVisible();
    await expect(
      bag.getByText("red · PLA · SKU SMOKE-1", { exact: true }),
    ).toBeVisible();
    await bag
      .getByRole("button", { name: "Increase Smoke part quantity" })
      .click();
    await expect(bag.getByText(/Quantity: 3/)).toBeVisible();
    expect(writes).toEqual([
      {
        method: "POST",
        path: "/cart/add",
        body: {
          cartId,
          skuNumber: "SMOKE-1",
          quantity: 2,
          color: "red",
          filamentType: "PLA",
          filamentId,
        },
      },
      {
        method: "PUT",
        path: "/cart/update",
        body: { cartId, itemId: line.id, quantity: 3 },
      },
    ]);
    await bag
      .getByRole("link", { name: "Review shipping and checkout" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Shipping and checkout review" }),
    ).toBeVisible();
    expect(api.requests).not.toContain(`POST /cart/${cartId}/quotes`);
    const quoteRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(`/cart/${cartId}/quotes`),
    );
    await page.getByRole("button", { name: "Request a fresh quote" }).click();
    expect((await quoteRequest).postDataJSON()).toEqual({});
    await expect(
      page.getByText("Smoke part · 3 × $2.50 · red · PLA · $7.50"),
    ).toBeVisible();
    await expect(page.getByText(/Ship to:/)).toContainText(
      "123 Example Avenue",
    );
    await expect(page.getByText("$1.13", { exact: true })).toBeVisible();
    await expect(page.getByText("$8.63", { exact: true })).toBeVisible();
    const confirm = page.getByRole("button", {
      name: "Continue to Square — $8.63 USD",
    });
    await expect(confirm).toBeEnabled();
    await confirm.focus();
    await expect(confirm).toBeFocused();
    await expect(
      page.getByText(/Returning here does not confirm payment/),
    ).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(
      api.requests.filter((key) => key === `POST /cart/${cartId}/quotes`),
    ).toHaveLength(1);
    expect(api.requests).toContain(`GET /cart/${cartId}/quotes/${quoteId}`);
    expect(api.requests).not.toContain(`POST /cart/${cartId}/checkout`);
    await checkLayout(page);
  });
}

test("lost requests recover the same run before allowing another request", async ({
  page,
  api,
}) => {
  const cartId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  api.responses.set("POST /cart/create", {
    body: { cartId, ownerId: "admin" },
  });
  api.responses.set(`GET /cart/${cartId}`, { body: { items: [], total: 0 } });
  api.responses.set(`GET /cart/${cartId}/agent-state`, {
    body: { cartId, revision: 0, items: [] },
  });
  const requests: { runId: string; message: string; uiRevision: number }[] = [];
  await page.route("https://api.lulu.test/agent/**", async (route) => {
    if (route.request().url().endsWith("/sessions"))
      return route.fulfill({
        json: {
          sessionId: "73f4ebed-0967-4112-8484-ed0263749e61",
          capability: "test-capability",
          expiresAt: 9e12,
          absoluteExpiresAt: 9e12,
        },
      });
    const input = route.request().postDataJSON();
    api.responses.set(
      `GET /cart/${cartId}/agent-actions/73f4ebed-0967-4112-8484-ed0263749e61/${input.runId}`,
      { status: 404, body: { error: "No confirmed cart action" } },
    );
    requests.push(input);
    if (requests.length === 1) {
      api.expectedNetworkErrors.set(
        route.request().url(),
        "Failed to load resource: net::ERR_FAILED",
      );
      return route.abort("failed");
    }
    return route.fulfill({
      json: {
        runId: input.runId,
        uiRevision: input.uiRevision,
        status: requests.length === 2 ? "running" : "completed",
        reason: null,
      },
    });
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" });
  const send = page.getByRole("button", { name: "Send shopping request" });
  await input.fill("Find pit tools");
  await send.click();
  await expect(page.getByText(/check the previous request/)).toBeVisible();
  await page.reload();
  await input.fill("Find a fan mount");
  await send.click();
  await expect(
    page.getByText(/previous request is still running/),
  ).toBeVisible();
  await send.click();
  await expect(page.getByText(/previous request has ended/)).toBeVisible();
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
  await expect(input).toHaveValue("Find a fan mount");
  await expect(page.getByRole("link", { name: "Smoke part" })).toBeVisible();
  await send.click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3]?.runId).not.toBe(requests[0]?.runId);
  expect(requests[3]?.message).toBe("Find a fan mount");
  await checkLayout(page);
});

test("agent checkout rereads the authoritative quote before explicit confirmation", async ({
  page,
  api,
}) => {
  const cartId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const filamentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const quoteId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const sessionId = "73f4ebed-0967-4112-8484-ed0263749e61";
  const line = {
    id: 1,
    productId: "SMOKE-1",
    name: "Smoke part",
    quantity: 3,
    color: "red",
    filamentType: "PLA",
    filamentId,
    price: 2.29,
  };
  api.responses.set("POST /cart/create", {
    body: { cartId, ownerId: "admin" },
  });
  api.responses.set(`GET /cart/${cartId}`, {
    body: { items: [line], total: 6.87 },
  });
  api.responses.set(`GET /cart/${cartId}/agent-state`, {
    body: {
      cartId,
      revision: 4,
      items: [
        {
          id: line.id,
          productId: 1,
          name: line.name,
          quantity: line.quantity,
          filamentId,
          color: line.color,
          material: line.filamentType,
          unitPrice: line.price,
        },
      ],
    },
  });
  api.responses.set("GET /v2/colors", {
    body: {
      success: true,
      data: [
        {
          publicId: filamentId,
          name: "Red PLA",
          color: "red",
          profile: "PLA",
          available: true,
        },
      ],
    },
  });
  const quoteRead = deferred<{ body: unknown }>();
  api.responses.set(`GET /cart/${cartId}/quotes/${quoteId}`, quoteRead.promise);
  const checkoutSubmissions: { quoteId: string; requestKey: string }[] = [];
  await page.route(
    `https://api.lulu.test/cart/${cartId}/checkout`,
    async (route) => {
      const submission = route.request().postDataJSON();
      checkoutSubmissions.push(submission);
      expect(route.request().method()).toBe("POST");
      api.responses.set(`POST /cart/${cartId}/checkout`, {
        body: {
          attemptId: sessionId,
          quoteId,
          state: "initiating",
          paymentUrl: "https://square.link/u/fixture",
          squareOrderId: "square-fixture",
        },
      });
      api.responses.set(
        `GET /checkout-attempts/by-request-key/${submission.requestKey}`,
        {
          body: {
            attemptId: sessionId,
            quoteId,
            cartId,
            state: "pending",
            paymentUrl: "https://square.link/u/fixture",
            order: null,
          },
        },
      );
      await route.fallback();
    },
  );
  let count = 0;
  await page.route("https://api.lulu.test/agent/**", async (route) => {
    if (route.request().url().endsWith("/sessions"))
      return route.fulfill({
        json: {
          sessionId,
          capability: "fixture",
          expiresAt: 9e12,
          absoluteExpiresAt: 9e12,
        },
      });
    if (route.request().url().endsWith("/cancel"))
      return route.fulfill({ json: {} });
    const { runId, uiRevision } = route.request().postDataJSON();
    count++;
    const result: AgentEffect =
      count === 1
        ? {
            status: "selected",
            selection: {
              productId: 1,
              quantity: 2,
              filamentId,
              material: "PLA",
              color: "red",
            },
          }
        : {
            kind: "checkout_review",
            accountId: "admin",
            status: "review_required",
            review: {
              quoteId,
              cartId,
              currency: "USD",
              subtotalCents: 458,
              shippingCents: 100,
              totalCents: 558,
              expiresAt: 9e12,
              confirmationRequired: true,
            },
          };
    await route.fulfill({
      contentType: "text/event-stream",
      body: completedAgentStream(sessionId, runId, uiRevision, result),
    });
  });
  await page.goto("/products/1");
  await expect(page.getByLabel("Color")).toBeEnabled();
  const input = page.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" });
  await input.fill("Choose two red");
  await input.press("Enter");
  await expect(page.getByLabel("Color")).toHaveValue(filamentId);
  await expect(page.getByLabel("Quantity")).toHaveValue("2");
  await page.getByLabel("Quantity").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByLabel("Quantity")).toHaveValue("3");
  await input.fill("Prepare checkout");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Shipping and checkout review" }),
  ).toBeVisible();
  await expect(page).toHaveURL(`/checkout?quoteId=${quoteId}&cartId=${cartId}`);
  await expect(page.getByText("Checking prices and shipping…")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Continue to Square/ }),
  ).toHaveCount(0);
  await expect(page.getByText("$5.58", { exact: true })).toHaveCount(0);
  expect(checkoutSubmissions).toEqual([]);
  quoteRead.resolve({
    body: {
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
          cartItemId: line.id,
          name: line.name,
          skuNumber: line.productId,
          quantity: line.quantity,
          filamentType: line.filamentType,
          filamentId,
          color: line.color,
          unitAmountCents: 229,
          totalAmountCents: 687,
        },
      ],
      subtotalCents: 687,
      shippingCents: 213,
      totalCents: 900,
    },
  });
  const confirm = page.getByRole("button", {
    name: "Continue to Square — $9.00 USD",
  });
  await expect(confirm).toBeEnabled();
  await expect(page.getByText("$9.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$2.13", { exact: true })).toBeVisible();
  await expect(page.getByText(/Smoke part · 3 ×/)).toContainText("red");
  await expect(page.getByText(/Ship to:/)).toContainText("123 Example Avenue");
  await expect(page.getByText("$5.58", { exact: true })).toHaveCount(0);
  expect(api.requests).toContain(`GET /cart/${cartId}/quotes/${quoteId}`);
  expect(
    api.requests.filter(
      (request) =>
        request.startsWith("POST ") && /checkout|quotes/.test(request),
    ),
  ).toEqual([]);
  expect(checkoutSubmissions).toEqual([]);
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await checkLayout(page);
  await confirm.press("Enter");
  await expect(page.getByText(/Payment is pending/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue this checkout with Square" }),
  ).toHaveAttribute("href", "https://square.link/u/fixture");
  expect(checkoutSubmissions).toEqual([
    { quoteId, requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
  ]);
  expect(
    api.requests.filter(
      (request) => request === `POST /cart/${cartId}/checkout`,
    ),
  ).toHaveLength(1);
});

test("agent order links display freshly verified order facts instead of streamed facts", async ({
  page,
  api,
}) => {
  const cartId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sessionId = "73f4ebed-0967-4112-8484-ed0263749e61";
  api.responses.set("POST /cart/create", {
    body: { cartId, ownerId: "admin" },
  });
  api.responses.set(`GET /cart/${cartId}`, { body: { items: [], total: 0 } });
  api.responses.set(`GET /cart/${cartId}/agent-state`, {
    body: { cartId, revision: 0, items: [] },
  });
  const orderRead = deferred<{ body: unknown }>();
  api.responses.set("GET /orders/1", orderRead.promise);
  await page.route("https://api.lulu.test/agent/**", async (route) => {
    if (route.request().url().endsWith("/sessions"))
      return route.fulfill({
        json: {
          sessionId,
          capability: "fixture",
          expiresAt: 9e12,
          absoluteExpiresAt: 9e12,
        },
      });
    if (route.request().url().endsWith("/cancel"))
      return route.fulfill({ json: {} });
    expect(route.request().headers()["x-expected-account-id"]).toBe("admin");
    const { runId, uiRevision } = route.request().postDataJSON();
    await route.fulfill({
      contentType: "text/event-stream",
      body: completedAgentStream(sessionId, runId, uiRevision, {
        kind: "owned_orders",
        accountId: "admin",
        status: "known",
        policy: "unknown",
        orders: [
          {
            id: 1,
            orderNumber: "STALE-AGENT-ORDER",
            paymentStatus: "paid",
            fulfillmentState: "processed",
            status: "delivered",
            totalAmountCents: 123,
            currency: "USD",
            shippedAt: "2026-09-22",
            deliveredAt: "2026-09-25",
            refund: null,
          },
        ],
      }),
    });
  });
  await page.goto("/");
  const request = page.waitForRequest("https://api.lulu.test/orders/1");
  await page
    .getByRole("textbox", { name: "YOUR SHOPPING REQUEST" })
    .fill("Where is my order?");
  await page.getByRole("button", { name: "Send shopping request" }).click();
  const ownedRead = await request;
  expect(ownedRead.method()).toBe("GET");
  expect(ownedRead.headers()["x-expected-account-id"]).toBe("admin");
  await expect(page).toHaveURL("/orders/1");
  await expect(page.getByText("Loading your orders…")).toBeVisible();
  await expect(
    page.getByText("STALE-AGENT-ORDER", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByText("$1.23", { exact: true })).toHaveCount(0);
  orderRead.resolve({
    body: {
      ...order,
      accountId: "admin",
      orderNumber: "FRESH-OWNED-ORDER",
      status: "pending",
      paymentStatus: "pending",
      fulfillmentState: "ready",
      totalAmountCents: 4500,
      fulfillment: {
        ...order.fulfillment,
        trackingNumber: "FRESH-TRACKING",
        trackingUrl: "https://carrier.example/track/fresh",
        shippedAt: null,
        deliveredAt: null,
      },
    },
  });
  await expect(
    page.getByRole("heading", { name: "Order FRESH-OWNED-ORDER" }),
  ).toBeVisible();
  await expect(page.getByText("$45.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Order status: pending", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Payment: pending", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Fulfillment: Awaiting fulfillment", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Tracking: FRESH-TRACKING", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Shipped: Not available", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Delivered: Not available", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Track shipment" }),
  ).toHaveAttribute("href", "https://carrier.example/track/fresh");
  await expect(
    page.getByText("STALE-AGENT-ORDER", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByText("$1.23", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Payment: paid", { exact: true })).toHaveCount(0);
  expect(
    api.requests.filter((request) => request === "GET /orders/1"),
  ).toHaveLength(1);
  expect(
    api.requests.filter(
      (request) =>
        request.startsWith("POST ") && /checkout|quotes/.test(request),
    ),
  ).toEqual([]);
  await page.getByRole("link", { name: "Back to orders" }).focus();
  await expect(
    page.getByRole("link", { name: "Back to orders" }),
  ).toBeFocused();
  await checkLayout(page);
});
