import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { createShoppingAgent } from "../src/storefront/agent";
import { batchSchema } from "../src/storefront/agent-bindings";
import { readAgentStream } from "../src/storefront/agent-stream";
import {
  bindingFixture,
  bindingProducts,
  bindingStream,
  unknownFit,
} from "./agent-binding-fixtures";
import { mockCatalog } from "./catalog-fixtures";
import { renderWithClient as render, testClient } from "./query-client";

type Batch = ReturnType<typeof bindingFixture>;
const session = {
  sessionId: "73f4ebed-0967-4112-8484-ed0263749e61",
  capability: "controlled-capability",
  expiresAt: 9e12,
  absoluteExpiresAt: 9e12,
};
const cartId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => localStorage.clear());
const response = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/event-stream" } });
function component(batch: Batch, id: string) {
  const value = batch.messages[1].updateComponents.components.find(
    (node) => node.id === id,
  );
  if (!value) throw Error("Missing test node");
  return value;
}
function record(batch: Batch, id = 101) {
  const value = batch.messages[0].updateDataModel.value.products[id];
  if (!value) throw Error("Missing test record");
  return value;
}
function stubShopping(
  reply: (input: {
    runId: string;
    uiRevision: number;
  }) => Response | Promise<Response>,
) {
  mockCatalog(2);
  const catalog = vi.mocked(fetch).getMockImplementation();
  if (!catalog) throw Error("Missing catalog mock");
  vi.mocked(fetch).mockImplementation((url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/auth/get-session")
      return Promise.resolve(Response.json(null));
    if (path === "/cart/create")
      return Promise.resolve(
        Response.json({
          cartId,
          ownerId: null,
          guestToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      );
    if (path === `/cart/${cartId}`)
      return Promise.resolve(Response.json({ items: [], total: 0 }));
    if (path.endsWith("/agent-state"))
      return Promise.resolve(Response.json({ cartId, revision: 0, items: [] }));
    if (path === "/agent/sessions")
      return Promise.resolve(Response.json(session));
    if (path.endsWith("/cancel")) return Promise.resolve(Response.json({}));
    if (path.endsWith("/runs"))
      return Promise.resolve(reply(JSON.parse(String(init?.body))));
    return catalog(url, init);
  });
}
function ask(text = "Show catalog guidance") {
  fireEvent.change(
    screen.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" }),
    { target: { value: text } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Send shopping request" }),
  );
}

it.each(bindingProducts)(
  "renders bound $name through the real A2UI renderer",
  async (product) => {
    stubShopping((input) => {
      expect(input).not.toHaveProperty("uiContract");
      const correlation = { runId: input.runId, uiRevision: input.uiRevision };
      const batch = {
        ...bindingFixture([product.id], product.id),
        ...correlation,
      };
      return response(bindingStream(correlation, batch));
    });
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByText("Part 1");
    ask();
    await screen.findByRole("heading", { level: 1, name: product.name });
    expect(screen.getByRole("link", { name: product.name })).toHaveAttribute(
      "href",
      product.href,
    );
    expect(
      screen.getByRole("link", { name: "Choose this product" }),
    ).toHaveAttribute("href", product.href);
    expect(screen.getAllByText(product.price).length).toBeGreaterThan(0);
    expect(screen.getAllByText(unknownFit).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add to bag" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Shop all" }));
    await screen.findByText("Part 1");
    expect(
      screen.queryByRole("heading", { name: product.name }),
    ).not.toBeInTheDocument();
  },
);

const invalid: [string, (batch: Batch) => void][] = [
  [
    "private namespace",
    (batch) =>
      Object.assign(component(batch, "agent-item-101"), {
        price: { path: "/cart/total" },
      }),
  ],
  [
    "wrong field",
    (batch) =>
      Object.assign(component(batch, "agent-item-101"), {
        price: { path: "/agentCatalog/products/101/name" },
      }),
  ],
  [
    "mixed product fields",
    (batch) =>
      Object.assign(component(batch, "agent-item-101"), {
        price: { path: "/agentCatalog/products/102/price" },
      }),
  ],
  [
    "record identity mismatch",
    (batch) => {
      record(batch).id = 102;
    },
  ],
  [
    "product link mismatch",
    (batch) => {
      record(batch).href = "/products/102";
    },
  ],
  [
    "private record field",
    (batch) => Object.assign(record(batch), { providerId: "private" }),
  ],
  [
    "unsafe image",
    (batch) => {
      record(batch).image = "javascript:pay()";
    },
  ],
  [
    "unused record",
    (batch) => {
      batch.messages[0].updateDataModel.value.products[103] = {
        ...record(batch),
        id: 103,
        href: "/products/103",
      };
    },
  ],
  [
    "missing record",
    (batch) => {
      delete batch.messages[0].updateDataModel.value.products[101];
    },
  ],
  [
    "inactive bound focus",
    (batch) =>
      Object.assign(component(batch, "focus"), { active: false, ready: false }),
  ],
  [
    "disagreeing focus readiness",
    (batch) => Object.assign(component(batch, "focus"), { ready: false }),
  ],
  [
    "partial focus binding",
    (batch) => Object.assign(component(batch, "focus"), { selectedTitle: "" }),
  ],
  [
    "mismatched focus image",
    (batch) =>
      Object.assign(component(batch, "agent-photo"), {
        name: { path: "/agentCatalog/products/102/name" },
        src: { path: "/agentCatalog/products/102/image" },
      }),
  ],
  [
    "missing focus",
    (batch) => {
      batch.messages[1].updateComponents.components =
        batch.messages[1].updateComponents.components.filter(
          (node) => node.component !== "ProductFocus",
        );
    },
  ],
  [
    "dangling graph",
    (batch) =>
      Object.assign(component(batch, "products"), {
        entries: ["agent-missing"],
      }),
  ],
  [
    "unsupported action",
    (batch) =>
      Object.assign(component(batch, "products"), {
        next: { event: { name: "checkout" } },
      }),
  ],
  [
    "root replacement",
    (batch) => Object.assign(batch.messages[0].updateDataModel, { path: "/" }),
  ],
  [
    "oversized record",
    (batch) => {
      record(batch).name = "x".repeat(513);
    },
  ],
];
it.each(invalid)(
  "rejects %s before exposing either message",
  (_name, mutate) => {
    const batch = bindingFixture([101, 102]);
    mutate(batch);
    expect(batchSchema.safeParse(batch).success).toBe(false);
  },
);

it("bounds total snapshot bytes and record count", () => {
  const batch = bindingFixture(bindingProducts.map((product) => product.id));
  for (const item of Object.values(
    batch.messages[0].updateDataModel.value.products,
  ))
    item.description = "🦊".repeat(2048);
  expect(batchSchema.safeParse(batch).success).toBe(false);
  const many = bindingFixture();
  for (let id = 102; id <= 114; id++)
    many.messages[0].updateDataModel.value.products[id] = {
      ...record(many),
      id,
      href: `/products/${id}`,
    };
  expect(batchSchema.safeParse(many).success).toBe(false);
});

it("requires an inactive focus to have no bindings or images", () => {
  const batch = bindingFixture([101], null);
  expect(batchSchema.safeParse(batch).success).toBe(true);
  Object.assign(component(batch, "focus"), { images: ["agent-item-101"] });
  expect(batchSchema.safeParse(batch).success).toBe(false);
  Object.assign(component(batch, "focus"), {
    images: [],
    selectedTitle: { path: "/agentCatalog/products/101/name" },
  });
  expect(batchSchema.safeParse(batch).success).toBe(false);
});

it("keeps the previous bound surface unchanged when a later batch changes data but has invalid bindings", async () => {
  let count = 0;
  stubShopping(({ runId, uiRevision }) => {
    const batch = { ...bindingFixture(), runId, uiRevision };
    if (count++) {
      record(batch).name = "Poisoned replacement";
      Object.assign(component(batch, "agent-item-101"), {
        price: { path: "/cart/total" },
      });
    }
    return response(bindingStream({ runId, uiRevision }, batch));
  });
  render(<App />);
  ask();
  await screen.findByRole("heading", { name: "Tool holder", level: 1 });
  ask("Keep the previous result if this response fails");
  await screen.findByText(/check the previous request/);
  expect(
    screen.getByRole("heading", { name: "Tool holder", level: 1 }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Tool holder" })).toBeVisible();
  expect(screen.queryByText("Poisoned replacement")).not.toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" }),
  ).toHaveValue("Keep the previous result if this response fails");
  fireEvent.click(screen.getByRole("button", { name: "Shop all" }));
  await screen.findByText("Part 1");
});

it("renders ambiguous and absent matches with unknown fit and no selected product", async () => {
  let count = 0;
  stubShopping(({ runId, uiRevision }) =>
    response(
      bindingStream(
        { runId, uiRevision },
        {
          ...bindingFixture(count++ ? [] : [101, 102], null),
          runId,
          uiRevision,
        },
      ),
    ),
  );
  render(<App />);
  ask("Which one fits an unsupported vehicle?");
  await screen.findByRole("link", { name: "Tool holder" });
  expect(screen.getByRole("link", { name: "Pit stand" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Choose this product" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add to bag" })).toBeDisabled();
  ask("Show an absent product type");
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Tool holder" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("link", { name: "Choose this product" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Compatibility is not supplied/, {
      selector: "#composer-help",
    }),
  ).toBeVisible();
});

it("rejects a batch with stale run correlation and trailing malformed output", async () => {
  const batch = bindingFixture();
  const expected = {
    runId: batch.runId,
    uiRevision: batch.uiRevision,
    sessionId: session.sessionId,
  };
  for (const value of [
    bindingStream(expected, { ...batch, runId: crypto.randomUUID() }),
    bindingStream(expected, { ...batch, uiRevision: batch.uiRevision + 1 }),
    `${bindingStream(expected, batch)}data: {}\n\n`,
  ])
    await expect(
      readAgentStream(
        response(value),
        expected,
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow();
});

it("ignores delayed bound guidance after a direct browsing interaction", async () => {
  let finish: (() => void) | undefined;
  stubShopping(
    ({ runId, uiRevision }) =>
      new Promise<Response>((resolve) => {
        finish = () =>
          resolve(
            response(
              bindingStream(
                { runId, uiRevision },
                { ...bindingFixture(), runId, uiRevision },
              ),
            ),
          );
      }),
  );
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByText("Part 1");
  ask();
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Shop all" }));
  await act(async () => finish?.());
  expect(
    screen.queryByRole("link", { name: "Tool holder" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Part 1")).toBeVisible();
});

it("waits for clean EOF before publishing a validated bound batch", async () => {
  const batch = bindingFixture();
  const apply = vi.fn();
  let finish: (() => void) | undefined;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith("/sessions")) return Response.json(session);
    const { runId, uiRevision } = JSON.parse(String(init?.body));
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              bindingStream(
                { runId, uiRevision },
                { ...batch, runId, uiRevision },
              ),
            ),
          );
          finish = () => controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  const agent = createShoppingAgent(testClient(), "https://api.lulu.test", {
    apply,
    view: vi.fn(),
  });
  const pending = agent.send("Show tool holders");
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(apply).not.toHaveBeenCalled();
  finish?.();
  await pending;
  expect(apply).toHaveBeenCalledOnce();
  agent.dispose();
});
