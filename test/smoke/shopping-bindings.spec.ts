import {
  bindingFixture,
  bindingProducts,
  bindingStream,
  unknownFit,
} from "../agent-binding-fixtures";
import { checkLayout, expect, test } from "./fixtures";

const cartId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "73f4ebed-0967-4112-8484-ed0263749e61";

test("bound guidance covers the initial assortment while preserving direct keyboard controls", async ({
  page,
  api,
}) => {
  api.responses.set("POST /cart/create", {
    body: { cartId, ownerId: "admin" },
  });
  api.responses.set(`GET /cart/${cartId}`, { body: { items: [], total: 0 } });
  api.responses.set(`GET /cart/${cartId}/agent-state`, {
    body: { cartId, revision: 0, items: [] },
  });
  let index = 0;
  await page.route("https://api.lulu.test/agent/**", async (route) => {
    if (route.request().url().endsWith("/sessions"))
      return route.fulfill({
        json: {
          sessionId,
          capability: "controlled",
          expiresAt: 9e12,
          absoluteExpiresAt: 9e12,
        },
      });
    const input = route.request().postDataJSON();
    const { runId, uiRevision } = input;
    expect(input).not.toHaveProperty("uiContract");
    const product = bindingProducts[index++];
    if (!product) throw Error("Unexpected extra guidance request");
    await route.fulfill({
      contentType: "text/event-stream",
      body: bindingStream(
        { runId, uiRevision },
        { ...bindingFixture([product.id], product.id), runId, uiRevision },
      ),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Smoke part" })).toBeVisible();
  const input = page.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" });
  for (const product of bindingProducts) {
    await input.fill(`Show ${product.name}`);
    await input.press("Tab");
    await expect(
      page.getByRole("button", { name: "Send shopping request" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      product.name,
    );
    await expect(
      page.getByRole("link", { name: product.name, exact: true }),
    ).toHaveAttribute("href", product.href);
    await expect(
      page.getByRole("link", { name: "Choose this product" }),
    ).toHaveAttribute("href", product.href);
    await expect(page.getByText(unknownFit, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add to bag" }),
    ).toBeDisabled();
    await checkLayout(page);
  }
  await page.getByRole("button", { name: "Shop all", exact: true }).click();
  await expect(page.getByRole("link", { name: "Smoke part" })).toBeVisible();
  await page.getByRole("button", { name: "Bag (0)" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Your bag" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    api.requests.filter((request) =>
      /^(POST \/cart\/add|PUT \/cart\/update|POST \/checkout)/.test(request),
    ),
  ).toEqual([]);
  await checkLayout(page);
});

test("invalid bound data cannot partially replace a visible surface and ambiguity stays unselected", async ({
  page,
  api,
}) => {
  api.responses.set("POST /cart/create", {
    body: { cartId, ownerId: "admin" },
  });
  api.responses.set(`GET /cart/${cartId}`, { body: { items: [], total: 0 } });
  api.responses.set(`GET /cart/${cartId}/agent-state`, {
    body: { cartId, revision: 0, items: [] },
  });
  let count = 0;
  await page.route("https://api.lulu.test/agent/**", async (route) => {
    if (route.request().url().endsWith("/sessions"))
      return route.fulfill({
        json: {
          sessionId,
          capability: "controlled",
          expiresAt: 9e12,
          absoluteExpiresAt: 9e12,
        },
      });
    const { runId, uiRevision } = route.request().postDataJSON();
    count++;
    if (count === 3) {
      api.responses.set(
        `GET /cart/${cartId}/agent-actions/${sessionId}/${runId}`,
        { status: 404, body: { error: "No confirmed cart action" } },
      );
      return route.fulfill({
        json: { runId, uiRevision, status: "completed", reason: null },
      });
    }
    const batch = {
      ...bindingFixture(
        count >= 4 ? [101, 102] : [101],
        count >= 4 ? null : 101,
      ),
      runId,
      uiRevision,
    };
    if (count === 2) {
      const record = batch.messages[0].updateDataModel.value.products[101];
      const entry = batch.messages[1].updateComponents.components.find(
        (node) => node.id === "agent-item-101",
      );
      if (!record || !entry) throw Error("Missing fixture node");
      record.name = "Invalid replacement should stay hidden";
      Object.assign(entry, { price: { path: "/cart/total" } });
    }
    await route.fulfill({
      contentType: "text/event-stream",
      body: bindingStream({ runId, uiRevision }, batch),
    });
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" });
  await input.fill("Show tool holders");
  await input.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Tool holder",
  );
  await input.fill("Which one fits an unsupported vehicle?");
  await input.press("Enter");
  await expect(page.locator("#composer-help")).toContainText(
    "check the previous request",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Tool holder",
  );
  await expect(
    page.getByText("Invalid replacement should stay hidden"),
  ).toHaveCount(0);
  await expect(input).toHaveValue("Which one fits an unsupported vehicle?");
  await checkLayout(page);
  await input.press("Enter");
  await expect(page.locator("#composer-help")).toContainText(
    "previous request has ended",
  );
  await input.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Catalog guidance",
  );
  await expect(
    page.getByRole("link", { name: "Tool holder", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Pit stand", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Choose this product" }),
  ).toHaveCount(0);
  await expect(page.locator("#composer-help")).toContainText(unknownFit);
  await expect(page.getByRole("button", { name: "Add to bag" })).toBeDisabled();
  await page.getByRole("button", { name: "Shop all", exact: true }).click();
  await expect(page.getByRole("link", { name: "Smoke part" })).toBeVisible();
  await checkLayout(page);
});
