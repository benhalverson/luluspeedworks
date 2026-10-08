import { draft, otherId } from "../admin-fixtures";
import { checkLayout, draftList, expect, test } from "./fixtures";

test("mocked lost draft creation retains its key through reload and recovers without another POST", async ({
  page,
  api,
}) => {
  const storage = "lulu-admin-create-v1:https://api.lulu.test:admin";
  const recovered = draft({
    id: otherId,
    state: {
      answers: { name: "Recovered original" },
      history: [],
      pendingQuestions: [],
    },
  });
  const creations: { requestKey: string; target: { kind: string } }[] = [];
  const recoveredKeys: string[] = [];
  let allowRecovery = false;
  await page.route(
    "https://api.lulu.test/admin/product-drafts",
    async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: draftList() });
      expect(route.request().method()).toBe("POST");
      const input = route.request().postDataJSON();
      creations.push(input);
      expect(input.target).toEqual({ kind: "new" });
      expect(input.requestKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
          storage,
        ),
      ).toEqual(input);
      api.expectedNetworkErrors.set(
        route.request().url(),
        "Failed to load resource: net::ERR_FAILED",
      );
      await route.abort("failed");
    },
  );
  await page.route(
    "https://api.lulu.test/admin/product-drafts/by-request-key/*",
    async (route) => {
      expect(route.request().method()).toBe("GET");
      const key =
        new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
      recoveredKeys.push(key);
      expect(key).toBe(creations[0]?.requestKey);
      if (allowRecovery) return route.fulfill({ json: recovered });
      api.expectedNetworkErrors.set(
        route.request().url(),
        "Failed to load resource: net::ERR_FAILED",
      );
      await route.abort("failed");
    },
  );
  api.responses.set(`GET /admin/product-drafts/${otherId}`, {
    body: recovered,
  });
  api.responses.set(`GET /admin/product-drafts/${otherId}/preparation`, {
    body: { preparation: null },
  });
  api.responses.set(`GET /admin/product-drafts/${otherId}/operation`, {
    body: {
      operation: null,
      product: null,
      readiness: null,
      storefrontVisible: false,
    },
  });
  await page.goto("/admin/products");
  await page
    .getByRole("button", { name: "+ New product", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Draft status" }),
  ).toContainText("creation outcome is unresolved");
  expect(creations).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "+ New product", exact: true }),
  ).toBeDisabled();
  expect(creations).toHaveLength(1);
  allowRecovery = true;
  await page.getByRole("button", { name: "Reload saved state" }).click();
  await expect(
    page.getByRole("status", { name: "Draft status" }),
  ).toContainText("original conversation has been recovered");
  await expect(
    page.getByRole("region", { name: "Product Card" }),
  ).toContainText("Recovered original");
  expect(creations).toHaveLength(1);
  expect(new Set(recoveredKeys).size).toBe(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), storage)).toBe(
    "null",
  );
  await checkLayout(page);
});
