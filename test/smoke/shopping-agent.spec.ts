import { agentFixture } from "../agent-fixtures";
import { checkLayout, expect, test } from "./fixtures";

test("shopping requests compose A2UI and preserve direct browsing after failure", async ({
  page,
  api,
}) => {
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
            value: { ...correlation, reason: "inference_unavailable" },
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
          ...(fail ? { reason: "inference_unavailable" } : {}),
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pit tray");
  await expect(
    page.getByRole("link", { name: "Choose this product" }),
  ).toHaveAttribute("href", "/products/1");
  await expect(page.getByRole("button", { name: "Add to bag" })).toBeDisabled();
  await checkLayout(page);
  fail = true;
  await input.fill("What fits my buggy?");
  await input.press("Enter");
  await expect(page.locator("#composer-help")).toContainText(
    "Shopping guidance is unavailable",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pit tray");
  await expect(input).toHaveValue("What fits my buggy?");
  await page.getByRole("button", { name: "Shop all", exact: true }).click();
  await expect(page.getByRole("link", { name: "Smoke part" })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(api.requests.some((key) => key.startsWith("POST /cart"))).toBe(false);
});

test("lost requests recover the same run before allowing another request", async ({
  page,
  api,
}) => {
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
