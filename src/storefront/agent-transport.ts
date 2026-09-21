import { HttpAgent } from "@ag-ui/client";
import { z } from "zod";
import {
  type AgentComposition,
  compositionSchema,
  fallbackSchema,
  sessionSchema,
  shoppingMessage,
} from "./agent-contract";
import { authClient } from "./auth";

const progressSchema = z
  .object({
    runId: z.string(),
    uiRevision: z.number(),
    stage: z.enum(["admission", "inference"]),
    invocation: z.number().int().min(0).max(3),
  })
  .strict();
const endSchema = z
  .object({
    uiRevision: z.number(),
    status: z.enum(["completed", "fallback"]),
    reason: z.string().optional(),
  })
  .strict();

export async function requestGuidance(
  origin: string,
  input: { message: string; runId: string; uiRevision: number },
  signal: AbortSignal,
): Promise<AgentComposition> {
  shoppingMessage.parse(input);
  const timeout = AbortSignal.timeout(35_000);
  const lifetime = AbortSignal.any([signal, timeout]);
  const response = await authClient.$fetch("/agent/sessions", {
    baseURL: origin,
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    signal: lifetime,
    jsonParser: JSON.parse,
  });
  const session = sessionSchema.parse(response.data);
  if (
    session.expiresAt <= Date.now() ||
    session.absoluteExpiresAt <= Date.now()
  )
    throw new Error("Shopping session expired.");
  const path = `/agent/sessions/${session.sessionId}/runs`;
  const headers = { Authorization: `Bearer ${session.capability}` };
  const agent = new HttpAgent({
    url: new URL(path, origin).href,
    threadId: session.sessionId,
    headers,
    debug: false,
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.any([lifetime, agent.abortController.signal]),
        body: JSON.stringify({ ...input, context: [] }),
      }),
  });
  const cancel = () => {
    agent.abortRun();
    void authClient
      .$fetch(`${path}/${input.runId}/cancel`, {
        baseURL: origin,
        method: "POST",
        headers,
        credentials: "omit",
        cache: "no-store",
        timeout: 5000,
      })
      .catch(() => undefined);
  };
  lifetime.addEventListener("abort", cancel, { once: true });
  let candidate: AgentComposition | undefined;
  let error: Error | undefined;
  let started = false;
  let finished = false;
  let fallback = false;
  try {
    lifetime.throwIfAborted();
    await agent.runAgent(
      { runId: input.runId },
      {
        onEvent({ event }) {
          try {
            if (finished) throw new Error("Events after completion");
            if (event.type === "RUN_STARTED") {
              const start = z
                .object({
                  runId: z.literal(input.runId),
                  threadId: z.literal(session.sessionId),
                  metadata: z.object({
                    uiRevision: z.literal(input.uiRevision),
                  }),
                })
                .parse(event);
              started = start.runId === input.runId;
            } else if (!started) throw new Error("Missing start");
            else if (event.type === "CUSTOM") {
              const custom = z
                .object({ name: z.string(), value: z.unknown() })
                .parse(event);
              const payload =
                custom.name === "lulu.a2ui.v1"
                  ? compositionSchema.parse(custom.value)
                  : custom.name === "lulu.fallback.v1"
                    ? fallbackSchema.parse(custom.value)
                    : custom.name === "lulu.progress.v1"
                      ? progressSchema.parse(custom.value)
                      : null;
              if (
                !payload ||
                payload.runId !== input.runId ||
                payload.uiRevision !== input.uiRevision
              )
                throw new Error("Invalid run update");
              if ("messages" in payload) {
                if (candidate || fallback) throw new Error("Duplicate result");
                candidate = payload;
              } else if ("reason" in payload) {
                fallback = true;
                error = new Error(
                  payload.reason === "budget_exhausted"
                    ? "Shopping guidance has reached its monthly budget. Browse with the controls below."
                    : "Shopping guidance is unavailable. You can keep browsing or try again.",
                );
              }
            } else if (event.type === "RUN_FINISHED") {
              const end = z
                .object({
                  runId: z.literal(input.runId),
                  threadId: z.literal(session.sessionId),
                  result: endSchema,
                })
                .parse(event);
              if (
                end.result.uiRevision !== input.uiRevision ||
                (end.result.status !== "completed" && !fallback)
              )
                throw new Error("Run did not complete");
              finished = true;
            } else throw new Error("Unsupported event");
          } catch {
            error = new Error(
              "Shopping guidance is unavailable. You can keep browsing or try again.",
            );
          }
        },
      },
    );
    lifetime.throwIfAborted();
    if (error) throw error;
    if (!finished || !candidate)
      throw new Error(
        "Shopping guidance ended without a valid result. Please try again.",
      );
    return candidate;
  } finally {
    lifetime.removeEventListener("abort", cancel);
  }
}
