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
