import { focusManager, onlineManager } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { App } from "../src/App";
import { createShoppingAgent } from "../src/storefront/agent";
import { batchSchema } from "../src/storefront/agent-contract";
import { readAgentStream } from "../src/storefront/agent-stream";
import { createCatalogController } from "../src/storefront/controller";
import { agentFixture } from "./agent-fixtures";
import { mockCatalog } from "./catalog-fixtures";
import { renderWithClient as render, testClient } from "./query-client";

const session = {
  sessionId: "73f4ebed-0967-4112-8484-ed0263749e61",
  capability: "private-visit-capability",
  expiresAt: 9e12,
  absoluteExpiresAt: 9e12,
};
const expected = {
  sessionId: session.sessionId,
  runId: agentFixture.runId,
  uiRevision: agentFixture.uiRevision,
};
const custom = (name: string, value: unknown) => ({
  type: "CUSTOM",
  name,
  value,
});
function events(run = expected, reason?: string) {
  const correlation = { runId: run.runId, uiRevision: run.uiRevision };
  return [
    {
      type: "RUN_STARTED",
      threadId: session.sessionId,
      runId: run.runId,
      metadata: { uiRevision: run.uiRevision },
    },
    custom("lulu.progress.v1", {
      ...correlation,
      stage: "admission",
      invocation: 0,
    }),
    reason
      ? custom("lulu.fallback.v1", { ...correlation, reason })
      : custom("lulu.a2ui.v1", { ...agentFixture, ...correlation }),
    {
      type: "RUN_FINISHED",
      threadId: session.sessionId,
      runId: run.runId,
      result: {
        uiRevision: run.uiRevision,
        status: reason ? "fallback" : "completed",
        ...(reason ? { reason } : {}),
      },
    },
  ];
}
function sse(values: unknown[]) {
  return values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("");
}
function response(values: unknown[] = events()) {
  return new Response(sse(values), {
    headers: { "Content-Type": "text/event-stream" },
  });
}
function parse(value: Response) {
  return readAgentStream(
    value,
    expected,
    new AbortController().signal,
    vi.fn(),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function shoppingFetch(
  run: (body: typeof expected) => Response | Promise<Response> = (body) =>
    response(events(body)),
) {
  mockCatalog(2);
  const catalog = vi.mocked(fetch).getMockImplementation();
  if (!catalog) throw new Error("Missing catalog fixture");
  vi.mocked(fetch).mockImplementation((input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/agent/sessions")
      return Promise.resolve(Response.json(session));
    if (path.endsWith("/cancel"))
      return Promise.resolve(Response.json({ status: "fallback" }));
    if (path.endsWith("/runs"))
      return Promise.resolve(run(JSON.parse(String(init?.body))));
    return catalog(input, init);
  });
}
function ask(message = "Show me pit tools") {
  fireEvent.change(
    screen.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" }),
    { target: { value: message } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Send shopping request" }),
  );
}

it("renders a real validated A2UI composition, retains direct browsing and sends no cookies", async () => {
  shoppingFetch();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByText("Part 1");
  ask();
  await screen.findByRole("link", { name: "Pit tray" });
  expect(
    screen.getByRole("heading", { name: "Pit tray", level: 1 }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /Add to bag/ })).toBeDisabled();
  expect(screen.getByText("No part selected")).toBeVisible();
  const requests = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).includes("/agent/"));
  expect(requests).toHaveLength(2);
  expect(requests[1]?.[1]).toMatchObject({
    credentials: "omit",
    headers: { Authorization: `Bearer ${session.capability}` },
  });
  expect(JSON.stringify(requests[1]?.[0])).not.toContain(session.capability);
  expect(localStorage.getItem("agent")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Shop all" }));
  await screen.findByText("Part 1");
  expect(
    screen.queryByRole("link", { name: "Pit tray" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("The bench is clear.")).toBeVisible();
});

it.each([
  "disabled",
  "budget_exhausted",
  "rate_limited",
  "invalid_output",
  "timeout",
  "accounting_unavailable",
])(
  "keeps the last valid surface and input on %s without automatic inference retries",
  async (reason) => {
    let count = 0;
    shoppingFetch((body) =>
      response(events(body, count++ ? reason : undefined)),
    );
    render(<App />);
    ask();
    await screen.findByRole("link", { name: "Pit tray" });
    ask("Will this fit my car?");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send shopping request" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("link", { name: "Pit tray" })).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" }),
    ).toHaveValue("Will this fit my car?");
    expect(count).toBe(2);
  },
);

it.each(["category", "navigation", "cancel", "unmount"])(
  "ignores a delayed composition after %s",
  async (action) => {
    const pending = deferred<Response>();
    let run = expected;
    shoppingFetch((body) => {
      run = body;
      return pending.promise;
    });
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByText("Part 1");
    ask();
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([url]) => String(url).endsWith("/runs")),
      ).toBe(true),
    );
    if (action === "category")
      fireEvent.click(screen.getByRole("button", { name: "Pit Tools" }));
    if (action === "navigation")
      fireEvent.click(screen.getByRole("link", { name: "Part 1" }));
    if (action === "cancel")
      fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    if (action === "unmount") view.unmount();
    await act(async () => pending.resolve(response(events(run))));
    expect(
      screen.queryByRole("link", { name: "Pit tray" }),
    ).not.toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).endsWith("/cancel")),
    ).toBe(true);
  },
);

it("does not create a visit until explicitly submitted and rejects empty input", async () => {
  shoppingFetch();
  render(<App />);
  await screen.findByText("Part 1");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("/agent/")),
  ).toBe(false);
  ask("   ");
  const form = screen
    .getByRole("button", { name: "Send shopping request" })
    .closest("form");
  if (!form) throw new Error("Missing composer form");
  fireEvent.submit(form);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("/agent/")),
  ).toBe(false);
});

it("opening the suggested product restores direct controls even on the same URL", async () => {
  window.history.replaceState(null, "", "/products/1");
  shoppingFetch();
  render(<App />);
  ask();
  const choose = await screen.findByRole("link", {
    name: "Choose this product",
  });
  expect(choose).toHaveAttribute("href", "/products/1");
  fireEvent.click(choose);
  expect(window.location.pathname).toBe("/products/1");
  expect(
    screen.queryByRole("link", { name: "Choose this product" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Part 1" })).toBeVisible();
});

it.each(["Back to Shop all", "Lulu Speedworks home"])(
  "%s restores browsing and cancels pending guidance on the same URL",
  async (name) => {
    const pending = deferred<Response>();
    let count = 0;
    let run = expected;
    shoppingFetch((body) => {
      run = body;
      return count++ ? pending.promise : response(events(body));
    });
    render(<App />);
    ask();
    await screen.findByRole("heading", { name: "Pit tray", level: 1 });
    ask("Show me something else");
    await waitFor(() => expect(count).toBe(2));
    fireEvent.click(screen.getByRole("link", { name }));
    expect(window.location.pathname).toBe("/");
    await act(async () => pending.resolve(response(events(run))));
    expect(
      screen.queryByRole("heading", { name: "Pit tray", level: 1 }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Part 1" })).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).endsWith("/cancel")),
    ).toBe(true);
  },
);

it("accepts split UTF-8, CRLF frames and SSE comments", async () => {
  const data = new TextEncoder().encode(
    `: keepalive\r\n\r\n${sse(events()).replaceAll("\n", "\r\n")}`,
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of data) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  expect(
    (
      await parse(
        new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      )
    )?.batch,
  ).toEqual(batchSchema.parse(agentFixture));
});

it.each([
  ["missing start", () => events().slice(1)],
  ["duplicate start", () => [events()[0], ...events()]],
  ["missing completion", () => events().slice(0, -1)],
  [
    "duplicate outcome",
    () => [...events().slice(0, 3), events()[2], events()[3]],
  ],
  ["late progress", () => [...events().slice(0, 3), events()[1], events()[3]]],
  ["event after completion", () => [...events(), events()[1]]],
  ["unknown event", () => [events()[0], custom("unsafe", {})]],
  ["wrong revision", () => events({ ...expected, uiRevision: 99 })],
  ["wrong run", () => events({ ...expected, runId: crypto.randomUUID() })],
  ["completion without output", () => [events()[0], events()[3]]],
])("rejects %s", async (_name, values) => {
  await expect(parse(response(values()))).rejects.toThrow();
});

it("rejects oversized, incomplete, non-stream and invalid UTF-8 responses", async () => {
  await expect(parse(Response.json({ status: "completed" }))).rejects.toThrow();
  await expect(
    parse(
      new Response(null, { headers: { "Content-Type": "text/event-stream" } }),
    ),
  ).rejects.toThrow();
  await expect(
    parse(
      new Response(`data: ${"x".repeat(65_536)}`, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    ),
  ).rejects.toThrow();
  await expect(
    parse(
      new Response(`${sse(events())}data:`, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    ),
  ).rejects.toThrow();
  await expect(
    parse(
      new Response(Uint8Array.of(255), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    ),
  ).rejects.toThrow();
});

it.each([
  "component",
  "action",
  "binding",
  "url",
  "reference",
  "duplicate",
  "unreachable",
  "root",
])("rejects an unsafe %s before updating any UI", async (kind) => {
  const batch = structuredClone(agentFixture);
  const nodes = batch.messages[0]?.updateComponents.components;
  const rail = nodes?.[0];
  const entry = nodes?.[1];
  if (!nodes || !rail || !entry) throw new Error("Missing fixture nodes");
  if (kind === "component") Object.assign(entry, { component: "Script" });
  if (kind === "action")
    Object.assign(rail, { retry: { event: { name: "pay" } } });
  if (kind === "binding")
    Object.assign(entry, { name: { path: "/cart/total" } });
  if (kind === "url") Object.assign(entry, { href: "javascript:alert(1)" });
  if (kind === "reference") Object.assign(rail, { entries: ["agent-missing"] });
  if (kind === "duplicate") nodes.push(entry);
  if (kind === "unreachable") nodes.push({ ...entry, id: "agent-unused" });
  if (kind === "root") nodes.splice(0, 1);
  expect(batchSchema.safeParse(batch).success).toBe(false);
  shoppingFetch((body) =>
    response([
      events(body)[0],
      custom("lulu.a2ui.v1", {
        ...batch,
        runId: body.runId,
        uiRevision: body.uiRevision,
      }),
      events(body)[3],
    ]),
  );
  render(<App />);
  await screen.findByText("Part 1");
  ask();
  await screen.findByText(/Shopping guidance is unavailable/);
  expect(
    within(screen.getByRole("list", { name: "Catalog products" })).getByText(
      "Part 1",
    ),
  ).toBeVisible();
});

it.each(["a", "é", '"'])(
  "bounds serialized history for %s requests and preserves the newest context",
  async (character) => {
    const apply = vi.fn();
    const agent = createShoppingAgent(testClient(), "http://localhost:8787", {
      view: vi.fn(),
      apply,
    });
    const payloads: { message: string; context: { content: string }[] }[] = [];
    shoppingFetch((body) => {
      const serialized = JSON.stringify(body);
      payloads.push(JSON.parse(serialized));
      return new TextEncoder().encode(serialized).byteLength > 32768
        ? new Response(null, { status: 413 })
        : response(events(body));
    });
    for (let i = 0; i < 6; i++)
      await agent.send(`${i}${character.repeat(5999)}`);
    expect(apply).toHaveBeenCalledTimes(6);
    expect(payloads.at(-1)?.context.at(-1)?.content).toBe(
      `4${character.repeat(5999)}`,
    );
    expect(payloads.at(-1)?.context.length).toBeLessThan(5);
    agent.dispose();
  },
);

it("rejects a message exceeding the byte limit without posting a run and allows a shorter retry", async () => {
  const view = vi.fn();
  const apply = vi.fn();
  const agent = createShoppingAgent(testClient(), "http://localhost:8787", {
    view,
    apply,
  });
  shoppingFetch();
  await agent.send("\u0000".repeat(8192));
  expect(
    vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/runs")),
  ).toBe(false);
  expect(view).toHaveBeenLastCalledWith(
    expect.objectContaining({
      busy: false,
      status: expect.stringContaining("unavailable"),
    }),
  );
  await agent.send("Show me pit tools");
  expect(apply).toHaveBeenCalledTimes(1);
  agent.dispose();
});

it("expires visits, recovers unauthorized sessions only on explicit retry, and bounds history", async () => {
  const view = vi.fn();
  const apply = vi.fn();
  const agent = createShoppingAgent(testClient(), "http://localhost:8787", {
    view,
    apply,
  });
  let fail = false;
  const payloads: { context: unknown[] }[] = [];
  shoppingFetch((body) => {
    payloads.push(body as unknown as { context: unknown[] });
    return fail ? new Response(null, { status: 410 }) : response(events(body));
  });
  for (let i = 0; i < 10; i++) await agent.send(`Request ${i}`);
  expect(payloads.at(-1)?.context).toHaveLength(8);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/sessions")),
  ).toHaveLength(1);
  fail = true;
  await agent.send("Expired request");
  fail = false;
  await agent.send("Retry");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/sessions")),
  ).toHaveLength(2);
  agent.dispose();
});

it("discards a visit response after navigation, without starting inference", async () => {
  const pending = deferred<Response>();
  vi.mocked(fetch).mockReturnValue(pending.promise);
  const view = vi.fn();
  const apply = vi.fn();
  const agent = createShoppingAgent(testClient(), "http://localhost:8787", {
    view,
    apply,
  });
  const sending = agent.send("pit tools");
  agent.interrupt();
  pending.resolve(Response.json(session));
  await sending;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
  expect(view).toHaveBeenLastCalledWith(
    expect.objectContaining({ busy: false }),
  );
  agent.dispose();
});

it("reports failed visit creation and refreshes expired visits on explicit requests", async () => {
  const view = vi.fn();
  const agent = createShoppingAgent(testClient(), "http://localhost:8787", {
    view,
    apply: vi.fn(),
  });
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
  await agent.send("pit tools");
  expect(view).toHaveBeenLastCalledWith(
    expect.objectContaining({
      busy: false,
      status: expect.stringContaining("unavailable"),
    }),
  );
  shoppingFetch((body) => response(events(body)));
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ ...session, expiresAt: 1 }),
  );
  await agent.send("pit tools");
  await agent.send("fan mounts");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/sessions")),
  ).toHaveLength(2);
  agent.dispose();
});

it("times out a stalled fetch and keeps cancellation failures from affecting browsing", async () => {
  vi.useFakeTimers();
  const view = vi.fn();
  const agent = createShoppingAgent(testClient(), "http://localhost:8787", {
    view,
    apply: vi.fn(),
  });
  vi.mocked(fetch).mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      ),
  );
  const sending = agent.send("pit tools");
  await vi.advanceTimersByTimeAsync(35_000);
  await sending;
  expect(view).toHaveBeenLastCalledWith(
    expect.objectContaining({
      busy: false,
      status: expect.stringContaining("unavailable"),
    }),
  );
  vi.useRealTimers();
  const pending = deferred<Response>();
  shoppingFetch(() => pending.promise);
  const next = agent.send("retry");
  await vi.waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).endsWith("/runs")),
    ).toBe(true),
  );
  vi.mocked(fetch).mockRejectedValueOnce(new Error("cancel unavailable"));
  agent.cancel();
  pending.resolve(new Response(null, { status: 500 }));
  await next;
  expect(view).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: "Request cancelled. Your browsing is unchanged.",
    }),
  );
  agent.dispose();
});

it("aborts a stalled stream and handles reader cancellation failure", async () => {
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      throw new Error("reader closed");
    },
  });
  const reading = readAgentStream(
    new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    expected,
    abort.signal,
    vi.fn(),
  );
  const failed = expect(reading).rejects.toThrow();
  abort.abort();
  await failed;
});

it("validates dispatched request contexts and preserves work on repeated location publication", async () => {
  const controller = createCatalogController(testClient(), vi.fn());
  const surface = controller.surface;
  if (!surface) throw new Error("Missing surface");
  controller.navigate("/");
  controller.navigate("/");
  await surface.dispatchAction(
    { event: { name: "ask-shopping", context: { message: "", unsafe: true } } },
    "composer",
  );
  expect(fetch).not.toHaveBeenCalled();
  controller.dispose();
});

it.each(["clean", "trailing event", "truncated frame", "invalid UTF-8"])(
  "keeps progress busy and publishes only after a %s stream ending",
  async (ending) => {
    const client = testClient();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let run = expected;
    shoppingFetch((body) => {
      run = body;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
            controller.enqueue(
              new TextEncoder().encode(sse(events(body).slice(0, 2))),
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });
    render(<App />, client);
    await screen.findByText("Part 1");
    ask();
    await screen.findByText("Checking the catalog…");
    const query = client
      .getQueryCache()
      .find({ queryKey: ["shopping-stream"], exact: false });
    expect(query?.state).toMatchObject({
      status: "pending",
      fetchStatus: "fetching",
      data: undefined,
    });
    expect(
      screen.getByRole("button", { name: "Send shopping request" }),
    ).toBeDisabled();
    await act(async () => {
      stream.enqueue(new TextEncoder().encode(sse(events(run).slice(2))));
    });
    expect(
      screen.queryByRole("link", { name: "Pit tray" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send shopping request" }),
    ).toBeDisabled();
    await act(async () => {
      if (ending === "trailing event")
        stream.enqueue(new TextEncoder().encode(sse([events(run)[1]])));
      if (ending === "truncated frame")
        stream.enqueue(new TextEncoder().encode("data:"));
      if (ending === "invalid UTF-8") stream.enqueue(Uint8Array.of(0xc3));
      stream.close();
    });
    if (ending === "clean")
      await screen.findByRole("link", { name: "Pit tray" });
    else {
      await screen.findByText(/Shopping guidance is unavailable/);
      expect(screen.getByRole("link", { name: "Part 1" })).toBeVisible();
      expect(
        screen.queryByRole("link", { name: "Pit tray" }),
      ).not.toBeInTheDocument();
    }
    expect(
      client.getQueryCache().findAll({ queryKey: ["shopping-stream"] }),
    ).toHaveLength(0);
    expect(query?.getObserversCount()).toBe(0);
  },
);

it.each(["client", "button", "timeout"])(
  "%s cancellation aborts transport and leaves catalog and cart queries running",
  async (source) => {
    const client = testClient();
    const other = deferred<string>();
    const signals: AbortSignal[] = [];
    const reads = ["catalog", "cart"].map((name) =>
      client.fetchQuery({
        queryKey: [name, "pending"],
        queryFn: ({ signal }) => {
          signals.push(signal);
          return other.promise;
        },
      }),
    );
    const pending = deferred<Response>();
    const apply = vi.fn();
    const view = vi.fn();
    let run = expected;
    shoppingFetch((body) => {
      run = body;
      return pending.promise;
    });
    const agent = createShoppingAgent(client, "http://localhost:8787", {
      view,
      apply,
    });
    if (source === "timeout") vi.useFakeTimers();
    const sending = agent.send("private shopping message");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const query = client
      .getQueryCache()
      .find({ queryKey: ["shopping-stream"], exact: false });
    if (!query) throw new Error("Missing stream query");
    const signal = vi.mocked(fetch).mock.calls[1]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    expect(JSON.stringify(query.queryKey)).not.toMatch(/private|capability/);
    if (source === "client")
      await client.cancelQueries({ queryKey: query.queryKey, exact: true });
    if (source === "button") agent.cancel();
    if (source === "timeout") {
      await vi.advanceTimersByTimeAsync(35_000);
      vi.useRealTimers();
    }
    await sending;
    expect(signal?.aborted).toBe(true);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    expect(
      client.getQueryCache().findAll({ queryKey: ["shopping-stream"] }),
    ).toHaveLength(0);
    expect(query.getObserversCount()).toBe(0);
    expect(view).toHaveBeenLastCalledWith(
      expect.objectContaining({ busy: false }),
    );
    const lastView = view.mock.calls.length;
    pending.resolve(response(events(run)));
    await vi.waitFor(() => expect(apply).not.toHaveBeenCalled());
    expect(view).toHaveBeenCalledTimes(lastView);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).endsWith("/cancel")),
    ).toBe(true);
    other.resolve("untouched");
    expect(await Promise.all(reads)).toEqual(["untouched", "untouched"]);
    agent.dispose();
  },
);

it("never repeats inference on focus, reconnect, invalidation or a StrictMode remount", async () => {
  const client = testClient();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let run = expected;
  shoppingFetch((body) => {
    run = body;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
          controller.enqueue(
            new TextEncoder().encode(sse(events(body).slice(0, 2))),
          );
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  const mounted = render(
    <StrictMode>
      <App />
    </StrictMode>,
    client,
  );
  await screen.findByText("Part 1");
  ask();
  await screen.findByText("Checking the catalog…");
  const firstKey = client
    .getQueryCache()
    .find({ queryKey: ["shopping-stream"], exact: false })?.queryKey;
  async function automaticTriggers() {
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await client.invalidateQueries({ refetchType: "all" });
      await client.refetchQueries({
        queryKey: ["shopping-stream"],
        type: "all",
      });
    });
  }
  const runs = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/runs"));
  await automaticTriggers();
  expect(runs()).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Send shopping request" }),
  ).toBeDisabled();
  await act(async () => {
    stream.enqueue(new TextEncoder().encode(sse(events(run).slice(2))));
    stream.close();
  });
  await screen.findByRole("link", { name: "Pit tray" });
  await automaticTriggers();
  expect(runs()).toHaveLength(1);
  mounted.unmount();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
    client,
  );
  await screen.findByText("Part 1");
  await automaticTriggers();
  expect(runs()).toHaveLength(1);
  const next = deferred<Response>();
  shoppingFetch((body) => {
    run = body;
    return next.promise;
  });
  ask("new visit");
  await waitFor(() => expect(runs()).toHaveLength(1));
  const nextKey = client
    .getQueryCache()
    .find({ queryKey: ["shopping-stream"], exact: false })?.queryKey;
  expect(nextKey?.[1]).not.toBe(firstKey?.[1]);
  expect(nextKey?.[2]).not.toBe(firstKey?.[2]);
  await act(async () => next.resolve(response(events(run))));
  await screen.findByRole("link", { name: "Pit tray" });
  focusManager.setFocused(undefined);
});

it.each(["progress", "outcome"])(
  "cancels the SSE reader after %s without caching or applying a partial result",
  async (stage) => {
    const client = testClient();
    const apply = vi.fn();
    const view = vi.fn();
    const agent = createShoppingAgent(client, "http://localhost:8787", {
      apply,
      view,
    });
    const cancelled = vi.fn();
    shoppingFetch((body) => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                sse(
                  stage === "progress"
                    ? events(body).slice(0, 2)
                    : events(body),
                ),
              ),
            );
          },
          cancel: cancelled,
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });
    const sending = agent.send("cancel while streaming");
    await vi.waitFor(() =>
      expect(view).toHaveBeenCalledWith({
        busy: true,
        status: "Checking the catalog…",
      }),
    );
    const query = client
      .getQueryCache()
      .find({ queryKey: ["shopping-stream"], exact: false });
    if (!query) throw new Error("Missing stream query");
    expect(query.state.data).toBeUndefined();
    await client.cancelQueries({ queryKey: query.queryKey, exact: true });
    await sending;
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(view).toHaveBeenLastCalledWith(
      expect.objectContaining({
        busy: false,
        status: expect.stringContaining("unavailable"),
      }),
    );
    expect(
      client.getQueryCache().findAll({ queryKey: ["shopping-stream"] }),
    ).toHaveLength(0);
    agent.dispose();
  },
);

it.each(["navigation", "reset"])(
  "does not apply a completed result after %s before its continuation",
  async (action) => {
    const client = testClient();
    const apply = vi.fn();
    const agent = createShoppingAgent(client, "http://localhost:8787", {
      apply,
      view: vi.fn(),
    });
    shoppingFetch();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        event.action.type === "success" &&
        !event.action.manual
      ) {
        if (action === "navigation") agent.interrupt();
        else
          void client.resetQueries({
            queryKey: event.query.queryKey,
            exact: true,
          });
      }
    });
    await agent.send("superseded result");
    expect(apply).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).endsWith("/runs")),
    ).toHaveLength(1);
    unsubscribe();
    agent.dispose();
  },
);

it.each([200, 410])(
  "ignores an older run's late %s response after a newer result",
  async (status) => {
    const client = testClient();
    const pending = deferred<Response>();
    let oldRun = expected;
    let count = 0;
    shoppingFetch((body) => {
      if (count++ === 0) {
        oldRun = body;
        return pending.promise;
      }
      return response(events(body));
    });
    const apply = vi.fn();
    const view = vi.fn();
    const agent = createShoppingAgent(client, "http://localhost:8787", {
      apply,
      view,
    });
    const old = agent.send("old");
    await vi.waitFor(() => expect(count).toBe(1));
    await agent.send("new");
    const latest = apply.mock.calls[0]?.[0];
    pending.resolve(
      status === 200
        ? response(events(oldRun))
        : new Response(null, { status }),
    );
    await old;
    await agent.send("next");
    expect(apply).toHaveBeenCalledTimes(2);
    expect(latest.runId).toBe(oldRun.runId);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).endsWith("/sessions")),
    ).toHaveLength(1);
    expect(
      client.getQueryCache().findAll({ queryKey: ["shopping-stream"] }),
    ).toHaveLength(0);
    agent.dispose();
  },
);

it.each([
  ["inference before admission", [{ stage: "inference", invocation: 1 }]],
  ["inference at zero", [{ stage: "inference", invocation: 0 }]],
  [
    "duplicate admission",
    [
      { stage: "admission", invocation: 0 },
      { stage: "admission", invocation: 0 },
    ],
  ],
  [
    "gap",
    [
      { stage: "admission", invocation: 0 },
      { stage: "inference", invocation: 2 },
    ],
  ],
  [
    "regression",
    [
      { stage: "admission", invocation: 0 },
      { stage: "inference", invocation: 1 },
      { stage: "inference", invocation: 1 },
    ],
  ],
  [
    "wrong stage",
    [
      { stage: "admission", invocation: 0 },
      { stage: "admission", invocation: 1 },
    ],
  ],
  ["missing admission", []],
])("rejects progress ordering: %s", async (_name, progress) => {
  const values = events();
  await expect(
    parse(
      response([
        values[0],
        ...progress.map((value) =>
          custom("lulu.progress.v1", {
            ...expected,
            ...value,
            sessionId: undefined,
          }),
        ),
        ...values.slice(2),
      ]),
    ),
  ).rejects.toThrow();
});

it("accepts consecutive inference progress and rejects a reason on successful completion", async () => {
  const values = events();
  const progress = [1, 2, 3].map((invocation) =>
    custom("lulu.progress.v1", {
      runId: expected.runId,
      uiRevision: expected.uiRevision,
      stage: "inference",
      invocation,
    }),
  );
  await expect(
    parse(response([...values.slice(0, 2), ...progress, ...values.slice(2)])),
  ).resolves.toHaveProperty("batch");
  const terminal = values[3];
  await expect(
    parse(
      response([
        ...values.slice(0, 3),
        {
          ...terminal,
          result: {
            uiRevision: expected.uiRevision,
            status: "completed",
            reason: "disabled",
          },
        },
      ]),
    ),
  ).rejects.toThrow("Invalid completion");
});

it.each(["completed", "fallback", "tombstone"])(
  "recovers %s metadata using the same run before allowing new paid work",
  async (status) => {
    const payloads: (typeof expected)[] = [];
    shoppingFetch((body) => {
      payloads.push(body);
      if (payloads.length === 1)
        return Promise.reject(new Error("lost response"));
      if (payloads.length === 2)
        return Response.json({
          runId: body.runId,
          uiRevision: body.uiRevision,
          status: "running",
          reason: null,
        });
      if (payloads.length === 3)
        return Response.json({
          runId: body.runId,
          uiRevision: status === "tombstone" ? 0 : body.uiRevision,
          status: status === "completed" ? "completed" : "fallback",
          reason: status === "completed" ? null : "cancelled",
        });
      return response(events(body));
    });
    const view = vi.fn();
    const apply = vi.fn();
    const client = testClient();
    const agent = createShoppingAgent(client, "http://localhost:8787", {
      view,
      apply,
    });
    await agent.send("original request");
    expect(view).toHaveBeenLastCalledWith({
      busy: false,
      status: expect.stringContaining("check the previous request"),
    });
    await agent.send("edited input");
    expect(view).toHaveBeenLastCalledWith({
      busy: false,
      status: expect.stringContaining("still running"),
    });
    await agent.send("edited input");
    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[2]).toEqual(payloads[0]);
    expect(apply).not.toHaveBeenCalled();
    await agent.send("edited input");
    expect(payloads[3]?.runId).not.toBe(payloads[0]?.runId);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(
      client.getQueryCache().findAll({ queryKey: ["shopping-stream"] }),
    ).toHaveLength(0);
    agent.dispose();
  },
);

it.each(["wrong-run", "wrong-revision", "malformed", "transport"])(
  "retains unresolved identity on %s recovery failure even after navigation",
  async (kind) => {
    const payloads: (typeof expected)[] = [];
    shoppingFetch((body) => {
      payloads.push(body);
      if (payloads.length === 1 || kind === "transport")
        return Promise.reject(new Error("lost"));
      return Response.json({
        runId: kind === "wrong-run" ? crypto.randomUUID() : body.runId,
        uiRevision: kind === "wrong-revision" ? 99 : body.uiRevision,
        status: "completed",
        reason: kind === "malformed" ? "disabled" : null,
      });
    });
    const apply = vi.fn();
    const agent = createShoppingAgent(testClient(), "http://localhost:8787", {
      view: vi.fn(),
      apply,
    });
    await agent.send("first");
    agent.interrupt();
    await agent.send("second");
    await agent.send("third");
    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[2]).toEqual(payloads[0]);
    expect(apply).not.toHaveBeenCalled();
    agent.dispose();
  },
);

it("does not apply an old recovery stream after navigation", async () => {
  let count = 0;
  shoppingFetch((body) =>
    count++ === 0 ? Promise.reject(new Error("lost")) : response(events(body)),
  );
  const apply = vi.fn();
  const agent = createShoppingAgent(testClient(), "http://localhost:8787", {
    view: vi.fn(),
    apply,
  });
  await agent.send("first");
  agent.interrupt();
  await agent.send("next");
  expect(apply).not.toHaveBeenCalled();
  await agent.send("next");
  expect(apply).toHaveBeenCalledTimes(1);
  agent.dispose();
});

it("rejects an unsupported event after valid admission", async () => {
  await expect(
    parse(response([...events().slice(0, 2), custom("unsafe", {})])),
  ).rejects.toThrow("Unsupported agent event");
});

it("rejects a next-invocation progress event after the outcome", async () => {
  await expect(
    parse(
      response([
        ...events().slice(0, 3),
        custom("lulu.progress.v1", {
          runId: expected.runId,
          uiRevision: expected.uiRevision,
          stage: "inference",
          invocation: 1,
        }),
        events()[3],
      ]),
    ),
  ).rejects.toThrow("Late progress");
});

it.each(["interrupt", "cancel"] as const)(
  "does not register or post a run after immediate cached-session %s",
  async (action) => {
    const payloads: (typeof expected)[] = [];
    shoppingFetch((body) => {
      payloads.push(body);
      return response(events(body));
    });
    const agent = createShoppingAgent(testClient(), "http://localhost:8787", {
      view: vi.fn(),
      apply: vi.fn(),
    });
    await agent.send("establish visit");
    const pending = agent.send("cancelled request");
    agent[action]();
    await pending;
    expect(payloads).toHaveLength(1);
    await agent.send("new request");
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({ message: "new request" });
    agent.dispose();
  },
);
