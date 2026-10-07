import { agentFixture } from "../agent-fixtures";
import { checkLayout, expect, test } from "./fixtures";

for (const reason of [
  "inference_unavailable",
  "budget_exhausted",
  "accounting_unavailable",
]) {
  test(`shopping requests preserve A2UI browsing and bag after ${reason}`, async ({
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
      for (const message of batch.messages) {
        for (const node of message.updateComponents.components) {
          if ("image" in node) node.image = "";
          if ("src" in node) node.src = "";
        }
      }
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
          name: "lulu.progress.v1",
          value: { ...correlation, stage: "admission", invocation: 0 },
        },
        fail
          ? {
              type: "CUSTOM",
              name: "lulu.fallback.v1",
              value: { ...correlation, reason },
            }
          : {
              type: "CUSTOM",
              name: "lulu.a2ui.v1",
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

test("validated agent selections retain keyboard controls and checkout needs explicit review", async ({
  page,
  api,
}) => {
  const cartId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const filamentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const quoteId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const sessionId = "73f4ebed-0967-4112-8484-ed0263749e61";
  api.responses.set("POST /cart/create", {
    body: { cartId, ownerId: "admin" },
  });
  api.responses.set(`GET /cart/${cartId}`, { body: { items: [], total: 0 } });
  api.responses.set(`GET /cart/${cartId}/agent-state`, {
    body: { cartId, revision: 0, items: [] },
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
  api.responses.set(`GET /shipping-quotes/${quoteId}`, {
    status: 410,
    body: { error: "Expired" },
  });
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
    const result =
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
    const batch = structuredClone(agentFixture);
    for (const message of batch.messages)
      for (const node of message.updateComponents.components) {
        if ("image" in node) node.image = "";
        if ("src" in node) node.src = "";
      }
    const frames = [
      {
        type: "RUN_STARTED",
        threadId: sessionId,
        runId,
        metadata: { uiRevision },
      },
      {
        type: "CUSTOM",
        name: "lulu.progress.v1",
        value: { runId, uiRevision, stage: "admission", invocation: 0 },
      },
      {
        type: "CUSTOM",
        name: count === 1 ? "lulu.cart.v1" : "lulu.commerce.v1",
        value: { runId, uiRevision, result },
      },
      {
        type: "CUSTOM",
        name: "lulu.a2ui.v1",
        value: { ...batch, runId, uiRevision },
      },
      {
        type: "RUN_FINISHED",
        threadId: sessionId,
        runId,
        result: { uiRevision, status: "completed" },
      },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      body: frames
        .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
        .join(""),
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
  expect(
    api.requests.filter((request) => request.startsWith("POST /checkout")),
  ).toEqual([]);
  await checkLayout(page);
});
