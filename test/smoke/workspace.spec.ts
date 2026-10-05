import { draft, draftId } from "../admin-fixtures";
import { checkLayout, deferred, draftList, expect, test } from "./fixtures";

test("retains the existing in-person USD price on review and reload without mutation", async ({
  page,
  api,
}) => {
  api.responses.set(`GET /admin/product-drafts/${draftId}`, {
    body: draft({
      target: { kind: "existing", productId: 1 },
      context: {
        status: "available",
        product: {
          id: 1,
          name: "Existing part",
          description: "Known product facts",
          image: null,
          price: 3,
          inPersonPrice: 2.5,
          filamentType: "PLA",
          color: "Blue",
          skuNumber: null,
          publicFileServiceId: null,
        },
        categories: [],
      },
    }),
  });
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  await page.getByLabel("Correct a detail").selectOption("inPersonPrice");
  await expect(page.getByLabel("In-person price (USD)")).toHaveValue("2.50");
  const card = page.getByRole("region", { name: "Product Card" });
  await expect(card).toContainText("Current catalog online price: $3.00");
  await expect(card).toContainText("In-person price: 2.50");
  await page.reload();
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  await page.getByLabel("Correct a detail").selectOption("inPersonPrice");
  await expect(page.getByLabel("In-person price (USD)")).toHaveValue("2.50");
  expect(api.requests.every((request) => request.startsWith("GET "))).toBe(
    true,
  );
  await checkLayout(page);
});

for (const status of [401, 403]) {
  for (const operation of ["detail", "save"]) {
    test(`${operation} ${status} hides all private workspace UI until fresh verification`, async ({
      page,
      api,
    }) => {
      await page.goto("/admin/products");
      await expect(
        page.getByRole("button", { name: "Edit draft facts" }),
      ).toBeVisible();
      await checkLayout(page);
      expect(
        api.requests.filter((key) => key === "GET /admin/product-drafts"),
      ).toHaveLength(1);
      await page.getByRole("button", { name: "Products", exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Conversations", exact: true }),
      ).toBeFocused();
      expect(
        await page.evaluate(
          () =>
            document.activeElement?.matches(":focus-visible") &&
            parseFloat(getComputedStyle(document.activeElement).outlineWidth) >
              0,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "Edit draft facts" }).click();
      await page
        .getByLabel("Product name", { exact: true })
        .fill("Private edits");
      const oldVerification = deferred<{ body: unknown }>();
      if (operation === "detail") {
        api.responses.set("GET /admin/product-drafts", oldVerification.promise);
        api.responses.set(`GET /admin/product-drafts/${draftId}`, {
          status,
          body: {},
        });
        await page.evaluate(() =>
          window.dispatchEvent(new Event("visibilitychange")),
        );
      } else {
        api.responses.set(`POST /admin/product-drafts/${draftId}/prepare`, {
          status,
          body: {},
        });
        await page.getByRole("button", { name: "Save draft answers" }).click();
      }
      await expect(page.getByRole("alert")).toContainText(
        status === 401
          ? "Your session has expired"
          : "Administrator access is required",
      );
      oldVerification.resolve({ body: draftList() });
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(page.getByRole("complementary")).toHaveCount(0);
      await expect(page.getByText("Private smoke conversation")).toHaveCount(0);
      await expect(
        page.getByLabel("Product name", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "+ New product", exact: true }),
      ).toHaveCount(0);
      api.responses.set("GET /admin/product-drafts", { status: 503, body: {} });
      await page.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      await expect(page.getByRole("alert")).toHaveText(
        "Private conversations unavailable. Please retry.",
      );
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Retry conversations" }),
      ).toBeFocused();
      api.responses.clear();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", { name: "Edit draft facts" }),
      ).toBeVisible();
      await expect(page.getByText("Private smoke conversation")).toBeVisible();
      await checkLayout(page);
    });
  }
}

test("a delayed save cannot reopen the workspace after denial", async ({
  page,
  api,
}) => {
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  await page
    .getByLabel("Product name", { exact: true })
    .fill("Delayed private save");
  const save = deferred<{ body: unknown }>();
  api.responses.set(
    `POST /admin/product-drafts/${draftId}/prepare`,
    save.promise,
  );
  await page.getByRole("button", { name: "Save draft answers" }).click();
  await expect
    .poll(() =>
      api.requests.includes(`POST /admin/product-drafts/${draftId}/prepare`),
    )
    .toBe(true);
  api.responses.set("GET /admin/product-drafts", { status: 403, body: {} });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Administrator access is required",
  );
  const response = page.waitForResponse(
    (response) => response.request().method() === "POST",
  );
  save.resolve({
    body: draft({
      state: {
        answers: { name: "Delayed private save" },
        history: [],
        pendingQuestions: [],
      },
    }),
  });
  await response;
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Administrator access is required",
  );
});

test("storefront account and bag remain dialogs and share admin branding", async ({
  page,
  api,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Account", exact: true }),
  ).toBeVisible();
  await checkLayout(page);
  const brand = await page
    .getByRole("link", { name: "Lulu Speedworks home" })
    .innerHTML();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Your account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Shipping profile" }),
  ).toBeVisible();
  await expect(page.getByLabel("First name")).toHaveValue("Smoke");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Bag (0)" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Your bag" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Both bag triggers are valid return targets for the shared dialog.
  await expect(page.locator(":focus")).toHaveAttribute(
    "aria-haspopup",
    "dialog",
  );
  await expect(page.locator(":focus")).toBeVisible();
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Edit draft facts" }).waitFor();
  expect(
    await page.getByRole("link", { name: "Lulu Speedworks home" }).innerHTML(),
  ).toBe(brand);
  expect(api.requests).toContain("GET /profile");
  await checkLayout(page);
});

test("keyboard category entry and complete instructions keep one preparation-only card", async ({
  page,
  api,
}) => {
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  await page.getByLabel("Correct a detail").selectOption("categoryNames");
  const categories = page.getByLabel("Category names (one per line)");
  await categories.pressSequentially("First category");
  await categories.press("Enter");
  await categories.pressSequentially("Second category");
  await expect(categories).toHaveValue("First category\nSecond category");
  api.responses.set(`POST /admin/product-drafts/${draftId}/prepare`, {
    body: draft({
      revision: 2,
      state: {
        answers: {
          name: "Prepared part",
          description: "Owner facts",
          markupPercentage: "50",
          inPersonPrice: "2.50",
          categoryNames: ["First category", "Second category"],
        },
        history: [
          { role: "user", content: "Use 50 percent markup" },
          { role: "assistant", content: "Updated markup only." },
        ],
        pendingQuestions: [],
        interpretation: {
          intent: "create",
          status: "prepared",
          explanation: "Updated markup only.",
          confirmedCategoryNames: [],
          proposedCategoryNames: [],
          productionOptions: [],
        },
      },
    }),
  });
  await page
    .getByLabel("Product notes", { exact: true })
    .fill("Use 50 percent markup");
  await page.getByRole("button", { name: "Send instruction" }).click();
  const card = page.getByRole("region", { name: "Product Card" });
  await expect(card).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: "Create product — unavailable" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Product name", { exact: true })).toHaveCount(0);
  await expect(card).toContainText("Online markup: 50%");
  await expect(card).toContainText("In-person price: 2.50");
  await checkLayout(page);
});
