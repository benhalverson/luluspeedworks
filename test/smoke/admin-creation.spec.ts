import { draft, otherId } from "../admin-fixtures";
import { checkLayout, deferred, draftList, expect, test } from "./fixtures";

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

test("dirty draft answers and unsent notes survive a lost following creation response", async ({
  page,
  api,
}) => {
  const previous = draft({
    revision: 3,
    state: {
      answers: { name: "Draft A", description: "Already saved description" },
      history: [],
      pendingQuestions: [],
    },
  });
  const created = draft({ id: otherId });
  const root = "/admin/product-drafts";
  const savePath = `${root}/${previous.id}/prepare`;
  const writes: { path: string; body: unknown }[] = [];
  const recoveryKeys: string[] = [];
  const saveResponse = deferred<void>();
  let requestKey = "";
  let allowRecovery = false;
  api.responses.set(`GET ${root}`, { body: draftList(previous) });
  api.responses.set(`GET ${root}/${previous.id}`, { body: previous });
  api.responses.set(`GET ${root}/${created.id}`, { body: created });
  await page.route(`https://api.lulu.test${savePath}`, async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON();
    writes.push({ path: savePath, body });
    await saveResponse.promise;
    previous.state.answers = body.answers;
    previous.revision++;
    await route.fulfill({ json: previous });
  });
  await page.route(`https://api.lulu.test${root}`, async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON();
    writes.push({ path: root, body });
    requestKey = body.requestKey;
    api.responses.set(`GET ${root}`, {
      body: {
        drafts: [...draftList(previous).drafts, ...draftList(created).drafts],
      },
    });
    api.expectedNetworkErrors.set(
      route.request().url(),
      "Failed to load resource: net::ERR_FAILED",
    );
    await route.abort("failed");
  });
  await page.route(
    `https://api.lulu.test${root}/by-request-key/*`,
    async (route) => {
      expect(route.request().method()).toBe("GET");
      recoveryKeys.push(
        new URL(route.request().url()).pathname.split("/").at(-1) ?? "",
      );
      if (allowRecovery) return route.fulfill({ json: created });
      api.expectedNetworkErrors.set(
        route.request().url(),
        "Failed to load resource: net::ERR_FAILED",
      );
      await route.abort("failed");
    },
  );
  await page.goto("/admin/products");
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  const card = page.getByRole("region", { name: "Product Card" });
  await card
    .getByLabel("Product name", { exact: true })
    .fill("Acknowledged draft A");
  await page
    .getByRole("textbox", { name: "Product notes", exact: true })
    .fill("Unsent note for A");
  const create = page.getByRole("button", {
    name: "+ New product",
    exact: true,
  });
  await create.focus();
  await expect(create).toBeFocused();
  await page.keyboard.press("Enter");
  const save = {
    path: savePath,
    body: {
      expectedRevision: 3,
      answers: {
        name: "Acknowledged draft A",
        description: "Already saved description",
      },
    },
  };
  await expect.poll(() => writes).toEqual([save]);
  await expect(create).toBeDisabled();
  saveResponse.resolve();
  const notice = page.getByRole("status", { name: "Draft status" });
  await expect(notice).toContainText("creation outcome is unresolved");
  await expect(notice).not.toContainText("Saved state has been reloaded");
  await expect(create).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Product notes", exact: true }),
  ).toHaveValue("Unsent note for A");
  expect(writes).toHaveLength(2);
  allowRecovery = true;
  await page.getByRole("button", { name: "Reload saved state" }).click();
  await expect(notice).toContainText(
    "original conversation has been recovered",
  );
  await expect(create).toBeEnabled();
  expect(requestKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(writes).toEqual([
    save,
    { path: root, body: { requestKey, target: { kind: "new" } } },
  ]);
  expect(recoveryKeys).toEqual([requestKey, requestKey]);
  expect(
    api.requests.filter((request) => request === `GET ${root}/${previous.id}`),
  ).toHaveLength(1);
  await expect(card.getByLabel("Product name", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("textbox", { name: "Product notes", exact: true }),
  ).toHaveValue("");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("lulu-admin-draft:https://api.lulu.test:admin"),
    ),
  ).toBe(JSON.stringify(otherId));
  const recent = page.getByRole("complementary", {
    name: "Recent conversations",
  });
  await recent
    .getByRole("button", { name: /New product/, pressed: false })
    .click();
  await page.getByRole("button", { name: "Edit draft facts" }).click();
  await expect(card.getByLabel("Product name", { exact: true })).toHaveValue(
    "Acknowledged draft A",
  );
  await expect(
    page.getByRole("textbox", { name: "Product notes", exact: true }),
  ).toHaveValue("Unsent note for A");
  expect(previous.state.answers).toEqual(save.body.answers);
  expect(previous.state.history).toEqual([]);
  expect(writes).toHaveLength(2);
  await checkLayout(page);
});
