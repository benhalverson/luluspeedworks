import { expect, type Locator, type Page, test } from "@playwright/test";

const apiOrigin = "http://localhost:8790";
const fixtureHeaders = { "x-demo-fixture-token": "lulu-local-demo" };
const photoBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4AWJ6tVXjPwgzMUABAAAA//8Lw1LcAAAABklEQVQDAEt4BZFa6totAAAAAElFTkSuQmCC",
  "base64",
);

async function answer(
  card: Locator,
  field: string,
  label: string,
  value: string,
) {
  await card.getByLabel("Correct a detail").selectOption(field);
  await card.getByLabel(label, { exact: true }).fill(value);
}

async function checkLayout(page: Page) {
  const logo = page.getByAltText("Lulu the dog with a racing badge");
  await logo.evaluate((image: HTMLImageElement) => image.decode());
  expect(
    await logo.evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("creates, recovers, edits and removes through the Product Card and real local API routes", async ({
  page,
}, info) => {
  // The replacement API fixture owns session setup. Production draft role checks,
  // database writes, encrypted storage and catalog routes remain active.
  const login = await page
    .context()
    .request.post(`${apiOrigin}/__fixture/login`, {
      headers: fixtureHeaders,
      data: { role: "admin" },
    });
  expect(login.ok()).toBe(true);
  const session = await page
    .context()
    .request.get(`${apiOrigin}/api/auth/get-session`);
  expect(await session.json()).toMatchObject({ user: { id: "demo-admin" } });
  const errors: string[] = [];
  const submissions: { action: string; preparationId: string }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/submit")
    )
      submissions.push(request.postDataJSON());
  });
  const name = `Browser ${info.project.name} wing mount ${Date.now()}`;
  await page.goto("/admin/products");
  await expect(
    page.getByRole("button", { name: "+ New product", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "+ New product", exact: true })
    .click();
  const card = page.getByRole("region", { name: "Product Card" });
  await expect(card).toHaveCount(1);
  await answer(card, "name", "Product name", name);
  await answer(
    card,
    "description",
    "Description",
    "A locally tested RC wing mount",
  );
  await answer(card, "filamentType", "Material", "PLA");
  await answer(card, "color", "Color", "Black");
  await answer(card, "markupPercentage", "Online markup percentage", "50");
  await answer(card, "inPersonPrice", "In-person price (USD)", "12.00");
  await card.getByLabel("Correct a detail").selectOption("categoryIds");
  await card
    .getByRole("listbox", { name: /^Existing categories/ })
    .selectOption(["1"]);
  await page
    .getByLabel("Product photos (up to 5)", { exact: true })
    .setInputFiles({
      name: "browser-part.png",
      mimeType: "image/png",
      buffer: photoBytes,
    });
  await expect(
    card.getByRole("list", { name: "Draft attachments" }),
  ).toContainText("browser-part.png");
  await page.getByLabel("Print file", { exact: true }).setInputFiles({
    name: "browser-part.stl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("solid localfixture\nendsolid localfixture\n"),
  });
  await expect(
    card.getByRole("list", { name: "Draft attachments" }),
  ).toContainText("browser-part.stl");
  await card
    .getByRole("button", { name: "Review product changes", exact: true })
    .click();
  await expect(card).toContainText("Production cost: $4.50");
  await expect(card).toContainText("Online price: $6.75");
  await expect(card).toContainText("In-person price: $12.00");
  await expect(
    card.getByRole("button", { name: "Create product", exact: true }),
  ).toBeEnabled();
  expect(submissions).toHaveLength(0);
  await checkLayout(page);
  await page.screenshot({
    path: `artifacts/local-admin/${info.project.name}-create-review.png`,
    fullPage: true,
  });
  const loseAck = await page
    .context()
    .request.post(`${apiOrigin}/__fixture/lose-upsert-ack`, {
      headers: fixtureHeaders,
    });
  expect(loseAck.ok()).toBe(true);
  await card
    .getByRole("button", { name: "Create product", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Check product operation" }),
  ).toBeEnabled();
  expect(submissions.map((input) => input.action)).toEqual(["create"]);
  await page.reload();
  await expect(
    card.getByRole("button", { name: "Check product operation" }),
  ).toBeEnabled();
  await expect(
    card.getByRole("button", { name: "Create product", exact: true }),
  ).toBeDisabled();
  expect(submissions).toHaveLength(1);
  await card.getByRole("button", { name: "Check product operation" }).click();
  await expect(card).toContainText("Product created.");
  await expect(
    card.getByRole("button", { name: "Manage created product" }),
  ).toBeEnabled();
  const products = await page
    .context()
    .request.get(`${apiOrigin}/products?page=1&limit=100`);
  const catalog = (await products.json()) as {
    products: { id: number; name: string }[];
  };
  const matching = catalog.products.filter((product) => product.name === name);
  expect(matching).toHaveLength(1);
  const productId = matching[0]?.id;
  if (!productId) throw new Error("Created product ID missing from catalog");
  await card.getByRole("button", { name: "Manage created product" }).click();
  await answer(card, "name", "Product name", `${name} revised`);
  await answer(card, "markupPercentage", "Online markup percentage", "100");
  await answer(card, "inPersonPrice", "In-person price (USD)", "14.25");
  await card
    .getByRole("button", { name: "Review product changes", exact: true })
    .click();
  await expect(card).toContainText("Online price: $9.00");
  await expect(card).toContainText("In-person price: $14.25");
  await expect(
    card.getByRole("button", { name: "Update product", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: `artifacts/local-admin/${info.project.name}-update-review.png`,
    fullPage: true,
  });
  await card
    .getByRole("button", { name: "Update product", exact: true })
    .click();
  await expect(card).toContainText("Product updated.");
  const edited = await page
    .context()
    .request.get(`${apiOrigin}/product/${productId}`);
  expect(await edited.json()).toMatchObject({
    name: `${name} revised`,
    price: 9,
    inPersonPrice: 14.25,
  });
  await card
    .getByRole("button", { name: "Review product deletion", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Delete product", exact: true }),
  ).toBeEnabled();
  expect(submissions.map((input) => input.action)).toEqual([
    "create",
    "update",
  ]);
  await page.screenshot({
    path: `artifacts/local-admin/${info.project.name}-delete-review.png`,
    fullPage: true,
  });
  await card
    .getByRole("button", { name: "Delete product", exact: true })
    .click();
  await expect(card).toContainText("Product deleted.");
  expect(submissions.map((input) => input.action)).toEqual([
    "create",
    "update",
    "delete",
  ]);
  const removed = await page
    .context()
    .request.get(`${apiOrigin}/product/${productId}`);
  expect(removed.status()).toBe(404);
  await page.reload();
  await expect(card).toContainText("Product deleted.");
  expect(submissions).toHaveLength(3);
  await expect(
    page.getByRole("button", { name: "+ New product", exact: true }),
  ).toBeEnabled();
  await checkLayout(page);
  expect(errors).toEqual([]);
});
