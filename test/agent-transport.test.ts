import { beforeEach, expect, it, vi } from "vitest";
import { compositionSchema } from "../src/storefront/agent-contract";
import { requestGuidance } from "../src/storefront/agent-transport";
import { agentFixture } from "./agent-fixture";

const input = {
  runId: agentFixture.runId,
  uiRevision: 12,
  message: "Show pit tools",
};
const session = {
  sessionId: "73f4ebed-0967-4112-8484-ed0263749e61",
  capability: "a-private-visit-capability-never-persisted",
  expiresAt: Date.now() + 600_000,
  absoluteExpiresAt: Date.now() + 3_600_000,
};
const start = {
  type: "RUN_STARTED",
  runId: input.runId,
  threadId: session.sessionId,
  metadata: { uiRevision: 12 },
};
const composition = {
  type: "CUSTOM",
  name: "lulu.a2ui.v1",
  value: agentFixture,
};
const end = {
  type: "RUN_FINISHED",
  runId: input.runId,
  threadId: session.sessionId,
  result: { uiRevision: 12, status: "completed" },
};
const progress = {
  type: "CUSTOM",
  name: "lulu.progress.v1",
  value: {
    runId: input.runId,
    uiRevision: 12,
    stage: "admission",
    invocation: 0,
  },
};

function sse(events: object[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
let events: object[];
beforeEach(() => {
  events = [start, progress, composition, end];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    expect(init?.credentials).toBe("omit");
    expect(init?.cache).toBe("no-store");
    if (String(url).endsWith("/sessions")) return Response.json(session);
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${session.capability}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({ ...input, context: [] });
    return sse(events);
  });
});

it("uses the official AG-UI transport and returns only a complete validated composition", async () => {
  expect(
    await requestGuidance(
      "https://api.example",
      input,
      new AbortController().signal,
    ),
  ).toEqual(agentFixture);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(
  [
    [start, composition, composition, end],
    [start, start, composition, end],
    [start, composition, end, start, composition, end],
    [start, { type: "STATE_SNAPSHOT", snapshot: {} }, composition, end],
    [start, { type: "CUSTOM", name: "unknown", value: {} }, end],
    [start, { ...composition, value: { ...agentFixture, uiRevision: 9 } }, end],
    [
      start,
      {
        ...composition,
        value: { ...agentFixture, runId: crypto.randomUUID() },
      },
      end,
    ],
    [
      start,
      { ...composition, value: { ...agentFixture, catalogId: "untrusted" } },
      end,
    ],
    [
      start,
      { type: "TEXT_MESSAGE_START", messageId: "untrusted", role: "assistant" },
      end,
    ],
    [start, composition],
    [start, end],
    [composition, end],
    [
      start,
      composition,
      { ...end, result: { uiRevision: 9, status: "completed" } },
    ],
    [
      start,
      composition,
      { ...end, result: { uiRevision: 12, status: "fallback" } },
    ],
    [{ ...start, metadata: { uiRevision: 9 } }, composition, end],
  ].map((stream) => ({ stream })),
)("rejects invalid stream sequencing or correlation %#", async ({ stream }) => {
  events = stream;
  await expect(
    requestGuidance("https://api.example", input, new AbortController().signal),
  ).rejects.toThrow();
});

it.each(["budget_exhausted", "disabled"])(
  "reports %s without replacing the last valid surface",
  async (reason) => {
    events = [
      start,
      {
        type: "CUSTOM",
        name: "lulu.fallback.v1",
        value: { runId: input.runId, uiRevision: 12, reason },
      },
      { ...end, result: { uiRevision: 12, status: "fallback", reason } },
    ];
    await expect(
      requestGuidance(
        "https://api.example",
        input,
        new AbortController().signal,
      ),
    ).rejects.toThrow(
      reason === "budget_exhausted" ? /monthly budget/ : /unavailable/,
    );
  },
);

it.each(["expiresAt", "absoluteExpiresAt"])(
  "rejects an expired %s before starting inference",
  async (field) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ ...session, [field]: 1 }),
    );
    await expect(
      requestGuidance(
        "https://api.example",
        input,
        new AbortController().signal,
      ),
    ).rejects.toThrow("expired");
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it("cancels an active run through the server contract and tolerates a lost cancel response", async () => {
  const controller = new AbortController();
  let runStarted = () => {};
  const started = new Promise<void>((resolve) => {
    runStarted = resolve;
  });
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith("/sessions")) return Response.json(session);
    if (String(url).endsWith("/cancel")) throw new Error("Connection lost");
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
      runStarted();
    });
  });
  const pending = requestGuidance(
    "https://api.example",
    input,
    controller.signal,
  );
  const rejection = expect(pending).rejects.toThrow();
  await started;
  controller.abort();
  await rejection;
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) =>
        String(url).endsWith(`/${input.runId}/cancel`),
      ),
  ).toBe(true);
});

it("rejects an already aborted request after session creation", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    requestGuidance("https://api.example", input, controller.signal),
  ).rejects.toThrow();
});

it("validates the backend wire fixture and rejects graph, binding, URL and shell injection", () => {
  expect(compositionSchema.parse(agentFixture)).toEqual(agentFixture);
  const components = agentFixture.messages[0]?.updateComponents.components;
  if (!components) throw new Error("Fixture missing components");
  for (const replacement of [
    [...components, components[0]],
    components.filter((node) => node.id !== "products"),
    components.filter((node) => node.id !== "focus"),
    components.map((node) =>
      node.id === "products"
        ? { ...node, entries: ["agent-one", "agent-one"] }
        : node,
    ),
    components.map((node) =>
      node.id === "products"
        ? { ...node, entries: ["agent-photo", "agent-two"] }
        : node,
    ),
    components.map((node) =>
      node.id === "products"
        ? { ...node, entries: ["agent-missing", "agent-two"] }
        : node,
    ),
    components.map((node) =>
      node.id === "focus" ? { ...node, images: ["agent-one"] } : node,
    ),
    components.map((node) =>
      node.id === "focus" ? { ...node, images: ["agent-missing"] } : node,
    ),
    components.map((node) =>
      node.id === "focus" ? { ...node, images: [] } : node,
    ),
    components.map((node) =>
      node.id === "agent-one"
        ? { ...node, href: "https://evil.example" }
        : node,
    ),
    components.map((node) =>
      node.id === "agent-one"
        ? { ...node, image: "javascript:alert(1)" }
        : node,
    ),
    components.map((node) =>
      node.id === "agent-one" ? { ...node, name: { path: "/cart" } } : node,
    ),
    components.map((node) =>
      node.id === "products"
        ? { ...node, next: { event: { name: "buy" } } }
        : node,
    ),
    components.map((node) =>
      node.id === "focus"
        ? { ...node, component: "PitBench", id: "root" }
        : node,
    ),
  ]) {
    expect(
      compositionSchema.safeParse({
        ...agentFixture,
        messages: [
          {
            version: "v0.9.1",
            updateComponents: {
              surfaceId: "storefront",
              components: replacement,
            },
          },
        ],
      }).success,
    ).toBe(false);
  }
  expect(
    compositionSchema.safeParse({
      ...agentFixture,
      limitations: ["x".repeat(8192), "x".repeat(8192), "x".repeat(8192)],
      messages: [
        {
          version: "v0.9.1",
          updateComponents: {
            surfaceId: "storefront",
            components: components.map((node) => ({
              ...node,
              ...(node.component === "ProductEntry"
                ? { description: "x".repeat(8192) }
                : {}),
            })),
          },
        },
      ],
    }).success,
  ).toBe(false);
});
