import { test as base, expect, type Page } from "@playwright/test";
import { draft } from "../admin-fixtures";

type Reply = { status?: number; body: unknown };
export function draftList(value = draft()) {
  const {
    state: _state,
    context: _context,
    attachments: _attachments,
    ...summary
  } = value;
  return { drafts: [summary] };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export const test = base.extend<{
  api: { responses: Map<string, Reply | Promise<Reply>>; requests: string[] };
}>({
  api: async ({ page }, use) => {
    const responses = new Map<string, Reply | Promise<Reply>>();
    const requests: string[] = [];
    const errors: string[] = [];
    const expectedHttpErrors = new Map<string, number>();
    const current = draft();
    current.state.history = [
      { role: "user", content: "Private smoke conversation" },
    ];
    const product = {
      id: 1,
      name: "Smoke part",
      description: "A physical RC part",
      price: 2.29,
      image: null,
      categoryId: null,
      skuNumber: "SMOKE-1",
      filamentType: "PLA",
    };
    const categories = [
      { categoryId: 1, categoryName: "RC Parts" },
      { categoryId: 2, categoryName: "Pit Tools" },
    ];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const expected = expectedHttpErrors.get(message.location().url);
      if (
        expected &&
        message
          .text()
          .startsWith(
            `Failed to load resource: the server responded with a status of ${expected}`,
          )
      )
        return;
      errors.push(message.text());
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === "http://127.0.0.1:4173") return route.continue();
      if (url.origin !== "https://api.lulu.test") {
        errors.push(`Unexpected external request: ${url}`);
        return route.abort();
      }
      const key = `${request.method()} ${url.pathname}`;
      requests.push(key);
      let reply = await responses.get(key);
      if (!reply) {
        if (url.pathname === "/api/auth/get-session")
          reply = {
            body: {
              user: {
                id: "admin",
                name: "Smoke admin",
                email: "smoke@example.test",
                emailVerified: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
              session: {
                id: "smoke-session",
                userId: "admin",
                token: "fixture",
                expiresAt: "2099-01-01T00:00:00.000Z",
              },
            },
          };
        else if (key === "GET /admin/product-drafts")
          reply = { body: draftList(current) };
        else if (url.pathname === `/admin/product-drafts/${current.id}`) {
          if (request.method() === "PUT") {
            current.state = request.postDataJSON().state;
            current.revision++;
          }
          reply = { body: current };
        } else if (url.pathname === "/categories") reply = { body: categories };
        else if (url.pathname === "/products")
          reply = {
            body: {
              products: [product],
              pagination: {
                page: 1,
                limit: 100,
                totalItems: 1,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            },
          };
        else if (url.pathname === "/product/1")
          reply = { body: { ...product, categories } };
        else if (url.pathname === "/profile")
          reply = {
            body: {
              id: "admin",
              email: "smoke@example.test",
              firstName: "Smoke",
              lastName: "Admin",
              address: "123 Example Avenue",
              city: "Portland",
              state: "OR",
              zipCode: "97201",
              country: "US",
              phone: "5035550100",
            },
          };
        else {
          errors.push(`Unexpected API request: ${key}`);
          return route.abort();
        }
      }
      if (reply.status && reply.status >= 400)
        expectedHttpErrors.set(url.href, reply.status);
      await route.fulfill({ status: reply.status ?? 200, json: reply.body });
    });
    await use({ responses, requests });
    expect(
      errors,
      "Unexpected browser errors or unmocked network requests",
    ).toEqual([]);
  },
});

export { expect };
export async function checkLayout(page: Page) {
  await expect(
    page.getByRole("link", { name: "Lulu Speedworks home" }),
  ).toBeVisible();
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
