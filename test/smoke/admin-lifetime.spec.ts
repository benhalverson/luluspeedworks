import { draft, draftId, transfer, transferId } from "../admin-fixtures";
import { checkLayout, deferred, expect, test } from "./fixtures";

async function settleBrowser(page: import("@playwright/test").Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

for (const interruption of ["visit leaves", "access denied"] as const) {
  test(`dirty save cannot create a new draft after ${interruption}`, async ({
    page,
    api,
  }) => {
    await page.goto("/admin/products");
    await page.getByRole("button", { name: "Edit draft facts" }).click();
    await page
      .getByLabel("Product name", { exact: true })
      .fill("Private pending facts");
    const save = deferred<{ body: unknown }>();
    const prepare = `POST /admin/product-drafts/${draftId}/prepare`;
    api.responses.set(prepare, save.promise);
    await page
      .getByRole("button", { name: "+ New product", exact: true })
      .click();
    await expect.poll(() => api.requests.includes(prepare)).toBe(true);
    if (interruption === "visit leaves") {
      await page.evaluate(() => {
        window.history.pushState({}, "", "/checkout");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(page).toHaveURL("/checkout");
      await expect(
        page.getByRole("region", { name: "Product Card" }),
      ).toHaveCount(0);
      await page.evaluate(() => {
        window.history.pushState({}, "", "/admin/products");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await page.getByRole("button", { name: "Edit draft facts" }).click();
      await expect(
        page.getByRole("region", { name: "Product Card" }),
      ).toBeVisible();
    } else {
      api.responses.set("GET /admin/product-drafts", { status: 403, body: {} });
      await page.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      await expect(page.getByRole("alert")).toContainText(
        "Administrator access is required",
      );
    }
    const response = page.waitForResponse(
      (reply) =>
        reply.request().method() === "POST" && reply.url().endsWith("/prepare"),
    );
    save.resolve({ body: draft({ revision: 2 }) });
    await response;
    await settleBrowser(page);
    expect(api.requests).not.toContain("POST /admin/product-drafts");
    if (interruption === "visit leaves") {
      await expect(
        page.getByRole("region", { name: "Product Card" }),
      ).toHaveCount(1);
      await checkLayout(page);
    } else {
      await expect(page.getByRole("navigation")).toHaveCount(0);
    }
  });
}

for (const stage of ["intent", "print upload"] as const) {
  test(`leaving the visit interrupts the ${stage} continuation`, async ({
    page,
    api,
  }) => {
    const pending = draft({ revision: 2 });
    pending.attachments.transfers = [
      transfer({ kind: "print", name: "part.stl", status: "pending" }),
    ];
    const intentBody = {
      draft: pending,
      transfer: {
        id: transferId,
        upload: {
          method: "PUT",
          url: "https://api.lulu.test/fixture-print-upload",
          headers: {},
        },
      },
    };
    const held = deferred<{ body: unknown }>();
    const intent = `POST /admin/product-drafts/${draftId}/attachments/intents`;
    const upload = "PUT /fixture-print-upload";
    api.responses.set(
      intent,
      stage === "intent" ? held.promise : { body: intentBody },
    );
    api.responses.set(upload, held.promise);
    await page.goto("/admin/products");
    await page.getByLabel("Print file", { exact: true }).setInputFiles({
      name: "part.stl",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("mesh"),
    });
    const heldKey = stage === "intent" ? intent : upload;
    await expect.poll(() => api.requests.includes(heldKey)).toBe(true);
    await page.evaluate(() => {
      window.history.pushState({}, "", "/checkout");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL("/checkout");
    await expect(
      page.getByRole("region", { name: "Product Card" }),
    ).toHaveCount(0);
    await page.evaluate(() => {
      window.history.pushState({}, "", "/admin/products");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.getByRole("button", { name: "Edit draft facts" }).click();
    await expect(
      page.getByRole("region", { name: "Product Card" }),
    ).toBeVisible();
    const response = page.waitForResponse((reply) =>
      stage === "intent"
        ? reply.url().endsWith("/intents")
        : reply.request().method() === "PUT",
    );
    held.resolve({ body: stage === "intent" ? intentBody : {} });
    await response;
    await settleBrowser(page);
    expect(api.requests).not.toContain(
      `POST /admin/product-drafts/${draftId}/attachments/transfers/${transferId}/confirm`,
    );
    if (stage === "intent") expect(api.requests).not.toContain(upload);
    await checkLayout(page);
  });
}
