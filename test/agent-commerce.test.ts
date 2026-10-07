import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createShoppingAgent } from "../src/storefront/agent";
import {
  type AgentAccess,
  type AgentEffect,
  readAgentCart,
} from "../src/storefront/agent-commerce";
import { recoveryStorage } from "../src/storefront/agent-recovery";
import { readAgentStream } from "../src/storefront/agent-stream";
import { createCatalogController } from "../src/storefront/controller";
import { agentFixture } from "./agent-fixtures";
import { testClient } from "./query-client";

const origin = "https://api.luluspeedworks.com";
const cartId = "11111111-1111-4111-8111-111111111111";
const token = "22222222-2222-4222-8222-222222222222";
const session = {
  sessionId: "33333333-3333-4333-8333-333333333333",
  capability: "visit-only",
  expiresAt: 9e12,
  absoluteExpiresAt: 9e12,
};
let owner: string | null | undefined;
let access: AgentAccess;
let effects: AgentEffect[];
let bodies: {
  runId: string;
  uiRevision: number;
  cart?: { id: string; revision: number };
}[];
let runResponse:
  | ((body: (typeof bodies)[number]) => Response | Promise<Response>)
  | undefined;
const state = { cartId, revision: 4, items: [] };
const selected: AgentEffect = {
  status: "selected",
  selection: {
    productId: 1,
    filamentId: token,
    quantity: 2,
    material: "PLA",
    color: "red",
  },
};
const applied: AgentEffect = {
  status: "applied",
  appliedRevision: 4,
  cart: state,
};
const orders: AgentEffect = {
  kind: "owned_orders",
  accountId: "alice",
  status: "unknown",
  orders: [],
  policy: "unknown",
};
const apply = vi.fn(async (_effects: AgentEffect[]) => {});
const refresh = vi.fn(async () => {});
function stream(body: (typeof bodies)[number], values = effects) {
  const correlation = { runId: body.runId, uiRevision: body.uiRevision };
  const events = [
    {
      type: "RUN_STARTED",
      threadId: session.sessionId,
      runId: body.runId,
      metadata: { uiRevision: body.uiRevision },
    },
    {
      type: "CUSTOM",
      name: "lulu.progress.v1",
      value: { ...correlation, stage: "admission", invocation: 0 },
    },
    ...values.map((result) => ({
      type: "CUSTOM",
      name: "kind" in result ? "lulu.commerce.v1" : "lulu.cart.v1",
      value: { ...correlation, result },
    })),
    {
      type: "CUSTOM",
      name: "lulu.progress.v1",
      value: { ...correlation, stage: "inference", invocation: 1 },
    },
    {
      type: "CUSTOM",
      name: "lulu.a2ui.v1",
      value: { ...agentFixture, ...correlation },
    },
    {
      type: "RUN_FINISHED",
      threadId: session.sessionId,
      runId: body.runId,
      result: { uiRevision: body.uiRevision, status: "completed" },
    },
  ];
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
function create(prepare = async (_signal: AbortSignal) => access) {
  const view = vi.fn();
  const browse = vi.fn();
  const agent = createShoppingAgent(testClient(), origin, {
    view,
    apply: browse,
    commerce: { owner: () => owner, prepare, apply, refresh },
  });
  return { agent, view, browse };
}
beforeEach(() => {
  localStorage.clear();
  owner = "alice";
  access = { accountId: "alice", cartId };
  effects = [];
  bodies = [];
  runResponse = undefined;
  apply.mockClear();
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (key: string, work: () => Promise<unknown>) => {
        const next = (queues.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(work);
        queues.set(key, next);
        return next;
      },
    },
  });
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/agent/sessions") return Response.json(session);
    if (path.endsWith("/cancel")) return Response.json({});
    if (path.endsWith("/runs")) {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      expect(recoveryStorage(origin, owner ?? null).read()?.body).toBe(
        init?.body,
      );
      return runResponse ? runResponse(body) : stream(body);
    }
    if (path.includes("/agent-actions/")) return Response.json(applied);
    if (path.endsWith("/agent-state")) return Response.json(state);
    throw Error(`Unexpected path ${path}`);
  });
});
afterEach(() => Reflect.deleteProperty(navigator, "locks"));

it.each(["guest", "account"])(
  "uses fresh revision and header-only %s authority then applies correlated effects",
  async (kind) => {
    if (kind === "guest") {
      owner = null;
      access = {
        accountId: null,
        cartId,
        guestToken: token,
        selection: { productId: 1, quantity: 2, filamentId: token },
      };
      effects = [selected, applied];
    } else effects = [orders];
    const { agent, browse } = create();
    await agent.send("add two");
    expect(bodies[0]?.cart).toEqual({ id: cartId, revision: 4 });
    expect(JSON.stringify(bodies)).not.toContain("visit-only");
    expect(JSON.stringify(bodies)).not.toContain("accountId");
    expect(JSON.stringify(bodies)).not.toContain("guestToken");
    const request = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith("/runs"))?.[1];
    expect(request?.credentials).toBe(kind === "guest" ? "omit" : "include");
    expect(request?.headers).toMatchObject(
      kind === "guest"
        ? { "X-Cart-Token": token }
        : { "X-Expected-Account-Id": "alice" },
    );
    expect(apply).toHaveBeenCalledWith(effects);
    expect(browse).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(recoveryStorage(origin, owner ?? null).read()).toBeUndefined();
    agent.dispose();
  },
);

it("reads owned orders without a cart and never invokes checkout confirmation", async () => {
  access = { accountId: "alice" };
  effects = [orders];
  const { agent } = create();
  await agent.send("where is my order");
  expect(bodies[0]?.cart).toBeUndefined();
  expect(apply).toHaveBeenCalledWith([orders]);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => /checkout|quotes/.test(String(url))),
  ).toBe(false);
  agent.dispose();
});

it("retains original identity across lost stream, reload, running status and terminal receipt reconciliation", async () => {
  runResponse = () => {
    throw Error("Lost stream after commit");
  };
  const first = create();
  await first.agent.send("add two");
  const original = bodies[0];
  expect(original).toBeDefined();
  first.agent.dispose();
  runResponse = (body) =>
    Response.json({
      ...body,
      cart: undefined,
      message: undefined,
      context: undefined,
      status: "running",
      reason: null,
    });
  const second = create();
  await second.agent.send("add two again");
  expect(bodies[1]).toEqual(original);
  expect(apply).not.toHaveBeenCalled();
  expect(recoveryStorage(origin, "alice").read()).toBeDefined();
  runResponse = (body) =>
    Response.json({
      runId: body.runId,
      uiRevision: body.uiRevision,
      status: "completed",
      reason: null,
    });
  await second.agent.send("retry");
  expect(bodies[2]).toEqual(original);
  expect(recoveryStorage(origin, "alice").read()).toBeUndefined();
  expect(apply).not.toHaveBeenCalled();
  expect(second.browse).not.toHaveBeenCalled();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) =>
        String(url).includes(
          `/agent-actions/${session.sessionId}/${original?.runId}`,
        ),
      ),
  ).toBe(true);
  runResponse = undefined;
  await second.agent.send("new request");
  expect(bodies[3]?.runId).not.toBe(original?.runId);
  second.agent.dispose();
});

it.each([401, 403, 409, 410])(
  "retains unknown work and never allocates a replacement run after %s",
  async (status) => {
    runResponse = () => Response.json({}, { status });
    const { agent } = create();
    await agent.send("add two");
    await agent.send("again");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(recoveryStorage(origin, "alice").read()).toBeDefined();
    agent.dispose();
  },
);

it.each(["account", "cart", "revision"])(
  "rejects a mismatched %s effect without exposing or acknowledging it",
  async (mismatch) => {
    effects =
      mismatch === "account"
        ? [{ ...orders, accountId: "bob" }]
        : [
            {
              ...applied,
              cart: { ...state, cartId: mismatch === "cart" ? token : cartId },
              appliedRevision: mismatch === "revision" ? 5 : 4,
            },
          ];
    const { agent, browse } = create();
    await agent.send("private request");
    expect(apply).not.toHaveBeenCalled();
    expect(browse).not.toHaveBeenCalled();
    expect(recoveryStorage(origin, "alice").read()).toBeDefined();
    agent.dispose();
  },
);

it.each(["interrupt", "dispose", "account"])(
  "rejects held completion after %s",
  async (action) => {
    let release!: (response: Response) => void;
    runResponse = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    effects = [orders];
    const { agent, browse } = create();
    const sent = agent.send("orders");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    if (action === "account") owner = "bob";
    else if (action === "interrupt") agent.interrupt();
    else agent.dispose();
    release(stream(bodies[0] ?? { runId: cartId, uiRevision: 1 }));
    await sent;
    expect(apply).not.toHaveBeenCalled();
    expect(browse).not.toHaveBeenCalled();
    expect(recoveryStorage(origin, "alice").read()).toBeDefined();
    agent.dispose();
  },
);

it("does not clear original owner recovery if identity changes while cart refresh completes", async () => {
  refresh.mockImplementationOnce(async () => {
    owner = "bob";
  });
  const { agent } = create();
  await agent.send("browse");
  expect(recoveryStorage(origin, "alice").read()).toBeDefined();
  agent.dispose();
});

it.each(["locks", "storage", "corrupt", "loading"])(
  "fails closed before runs with unavailable %s",
  async (failure) => {
    if (failure === "locks") Reflect.deleteProperty(navigator, "locks");
    if (failure === "storage")
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    if (failure === "corrupt")
      localStorage.setItem(recoveryStorage(origin, "alice").key, "{");
    if (failure === "loading") owner = undefined;
    const { agent } = create();
    await agent.send("add two");
    expect(bodies).toEqual([]);
    agent.dispose();
  },
);

it("ignores an obsolete queued lock", async () => {
  let grant!: () => Promise<unknown>;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_key: string, work: () => Promise<unknown>) =>
        new Promise((resolve) => {
          grant = async () => resolve(await work());
        }),
    },
  });
  const { agent } = create();
  const sent = agent.send("add two");
  agent.dispose();
  await grant();
  await sent;
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects owner changes during preparation", async () => {
  const { agent } = create(async () => ({ ...access, accountId: "bob" }));
  await agent.send("add two");
  expect(bodies).toEqual([]);
  agent.dispose();
});

it.each([401, 403, 409, 500])(
  "rejects denied cart reads (%s)",
  async (status) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({}, { status }));
    await expect(
      readAgentCart(origin, access, new AbortController().signal),
    ).rejects.toThrow();
  },
);
it("keeps terminal recovery honest when there is no confirmed receipt", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 404 }));
  expect(
    await readAgentCart(origin, access, new AbortController().signal, {
      sessionId: session.sessionId,
      runId: cartId,
    }),
  ).toBeUndefined();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ ...state, cartId: token }),
  );
  await expect(
    readAgentCart(origin, access, new AbortController().signal),
  ).rejects.toThrow("Wrong shopping bag");
});
it("rejects excessive effect frames", async () => {
  await expect(
    readAgentStream(
      stream(
        { runId: cartId, uiRevision: 1 },
        Array.from({ length: 9 }, () => selected),
      ),
      { sessionId: session.sessionId, runId: cartId, uiRevision: 1 },
      new AbortController().signal,
      vi.fn(),
    ),
  ).rejects.toThrow("Too many");
});

it.each(["missing-access", "owner", "run", "revision", "cart"])(
  "rejects changed persisted %s before sending",
  async (change) => {
    runResponse = async () => {
      throw Error("lost");
    };
    const first = create();
    await first.agent.send("add two");
    first.agent.dispose();
    const storage = recoveryStorage(origin, "alice");
    const saved = JSON.parse(localStorage.getItem(storage.key) ?? "{}");
    if (change === "missing-access") delete saved.access;
    else if (change === "owner") saved.access.accountId = "bob";
    else {
      const body = JSON.parse(saved.body);
      if (change === "run") body.runId = token;
      if (change === "revision") body.uiRevision++;
      if (change === "cart") body.cart.id = token;
      saved.body = JSON.stringify(body);
    }
    localStorage.setItem(storage.key, JSON.stringify(saved));
    bodies = [];
    const next = create();
    await next.agent.send("retry");
    expect(bodies).toEqual([]);
    next.agent.dispose();
  },
);
it("retains recovery when another tab replaces or storage refuses to remove it", async () => {
  runResponse = async () => {
    throw Error("lost");
  };
  const { agent } = create();
  await agent.send("add");
  agent.dispose();
  const storage = recoveryStorage(origin, "alice");
  const saved = storage.read();
  if (!saved) throw Error("Missing recovery");
  expect(() => storage.clear(token)).toThrow("request changed");
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
  expect(() => storage.clear(saved.runId)).toThrow("storage unavailable");
  vi.restoreAllMocks();
  localStorage.clear();
  expect(() => storage.clear(token)).toThrow("request changed");
});
it("does not publish a failed lock after disposal", async () => {
  let reject!: (reason: Error) => void;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    },
  });
  const { agent, view } = create();
  const pending = agent.send("add");
  agent.dispose();
  const calls = view.mock.calls.length;
  reject(Error("lock failed"));
  await pending;
  expect(view).toHaveBeenCalledTimes(calls);
});
it("rejects completed output after an unannounced owner change", async () => {
  runResponse = async (body) => {
    owner = "bob";
    return stream(body);
  };
  const { agent } = create();
  await agent.send("add");
  expect(apply).not.toHaveBeenCalled();
  expect(recoveryStorage(origin, "alice").read()).toBeDefined();
  agent.dispose();
});
it("rejects commerce effects in a read-only caller", async () => {
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    String(url).endsWith("/sessions")
      ? Response.json(session)
      : stream(JSON.parse(String(init?.body)), [selected]),
  );
  const view = vi.fn();
  const browse = vi.fn();
  const agent = createShoppingAgent(testClient(), origin, {
    view,
    apply: browse,
  });
  await agent.send("select");
  expect(browse).not.toHaveBeenCalled();
  expect(view).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: expect.stringContaining("unavailable") }),
  );
  agent.dispose();
});

it("does not restore a disposed controller after held commerce application", async () => {
  effects = [selected];
  let release!: () => void;
  apply.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const controller = createCatalogController(testClient(), vi.fn(), origin, {
    owner: () => owner,
    prepare: async () => access,
    apply,
    refresh,
  });
  await controller.surface?.dispatchAction(
    { event: { name: "ask-shopping", context: { message: "select red" } } },
    "composer",
  );
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  controller.dispose();
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
it("keeps recovery when ownership changes during the final fresh cart read", async () => {
  const original = vi.mocked(fetch).getMockImplementation();
  let reads = 0;
  vi.mocked(fetch).mockImplementation(async (...args) => {
    const result = await original?.(...args);
    if (String(args[0]).endsWith("/agent-state") && ++reads === 2)
      owner = "bob";
    if (!result) throw Error("Missing response");
    return result;
  });
  const { agent } = create();
  await agent.send("add");
  expect(recoveryStorage(origin, "alice").read()).toBeDefined();
  expect(refresh).not.toHaveBeenCalled();
  agent.dispose();
});
