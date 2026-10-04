import { type QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  type AgentBatch,
  type AgentSession,
  runStatusSchema,
  sessionSchema,
} from "./agent-contract";
import { readAgentStream } from "./agent-stream";

export type AgentView = { busy: boolean; status: string };
const ready =
  "Ask about products. Choose colors and add to your bag using the product controls.";
const unresolvedStatus =
  "Shopping guidance is unavailable. Your browsing is unchanged. Send again to check the previous request before starting another.";
const unavailable =
  "Shopping guidance is unavailable. Your browsing is unchanged. You can send your request again.";

/**
 * Own an anonymous visit and its explicit, non-retrying query attempts.
 * Uncertain runs retain their original payload/capability until a correlated
 * terminal reply arrives; a resend checks that run before allowing new work.
 * Navigation invalidates surface application without discarding recovery metadata.
 */
export function createShoppingAgent(
  client: QueryClient,
  origin: string,
  callbacks: {
    view: (view: AgentView) => void;
    apply: (batch: AgentBatch) => void;
  },
) {
  let session: AgentSession | undefined;
  const visitId = crypto.randomUUID();
  let pending: { queryKey: readonly string[] } | undefined;
  let unresolved:
    | {
        runId: string;
        uiRevision: number;
        session: AgentSession;
        body: string;
        message: string;
      }
    | undefined;
  let revision = 0;
  let disposed = false;
  const history: { role: "user"; content: string }[] = [];
  /** Send header-only visit credentials; never persist capabilities in the query cache. */
  const post = (
    path: string,
    signal: AbortSignal,
    visit?: AgentSession,
    body?: string,
  ) =>
    fetch(new URL(path, origin), {
      method: "POST",
      credentials: "omit",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(visit ? { Authorization: `Bearer ${visit.capability}` } : {}),
      },
      body,
    });
  /** Reuse a valid capability or create one, rejecting a response after cancellation. */
  async function getSession(signal: AbortSignal): Promise<AgentSession> {
    if (
      !session ||
      Math.min(session.expiresAt, session.absoluteExpiresAt) <= Date.now()
    ) {
      const response = await post("/agent/sessions", signal);
      if (!response.ok) throw new Error("Session unavailable");
      const created = sessionSchema.parse(await response.json());
      signal.throwIfAborted();
      session = created;
    }
    return session;
  }
  /** Abort the current attempt; direct interactions also invalidate its surface revision. */
  function stop(invalidate = true) {
    if (invalidate) revision++;
    const current = pending;
    pending = undefined;
    if (!current) return;
    void client.cancelQueries({ queryKey: current.queryKey, exact: true });
  }
  return {
    /**
     * Submit a new request, or recover the unresolved request regardless of new input.
     * Recovery status never replays a surface. Errors preserve browsing and metadata;
     * only a later explicit submission can start new work after terminal recovery.
     */
    async send(message: string) {
      stop(false);
      const recovery = unresolved;
      const runId = recovery?.runId ?? crypto.randomUUID();
      const queryKey = ["shopping-stream", visitId, runId, crypto.randomUUID()];
      const current = { queryKey };
      pending = current;
      const uiRevision = recovery?.uiRevision ?? ++revision;
      const attemptRevision = revision;
      /** Only the latest live attempt may publish view or surface changes. */
      const active = () => !disposed && pending === current;
      const observer = new QueryObserver(client, {
        queryKey,
        enabled: false,
        retry: false,
        retryOnMount: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
        networkMode: "always",
        queryFn: async ({ signal }) => {
          let runSession: AgentSession | undefined;
          /** Best-effort cancellation also tombstones requests that have not reached the server. */
          const cancel = () => {
            if (runSession) {
              void post(
                `/agent/sessions/${runSession.sessionId}/runs/${runId}/cancel`,
                AbortSignal.timeout(5000),
                runSession,
              ).catch(() => {});
            }
          };
          signal.addEventListener("abort", cancel, { once: true });
          try {
            runSession = recovery?.session ?? (await getSession(signal));
            signal.throwIfAborted();
            const run = recovery ?? {
              runId,
              uiRevision,
              session: runSession,
              body: serializeRequest(runId, uiRevision, message, history),
              message,
            };
            unresolved = run;
            const response = await post(
              `/agent/sessions/${runSession.sessionId}/runs`,
              signal,
              runSession,
              run.body,
            );
            signal.throwIfAborted();
            if (response.status === 401 || response.status === 410) {
              session = undefined;
              unresolved = undefined;
            }
            if (!response.ok) throw new Error("Run unavailable");
            if (
              response.headers
                .get("content-type")
                ?.startsWith("application/json")
            ) {
              const status = runStatusSchema.parse(await response.json());
              signal.throwIfAborted();
              if (
                status.runId !== runId ||
                (status.uiRevision !== uiRevision &&
                  !(
                    status.uiRevision === 0 &&
                    status.status === "fallback" &&
                    status.reason === "cancelled"
                  ))
              )
                throw new Error("Stale agent status");
              if (status.status !== "running") unresolved = undefined;
              return status;
            }
            const outcome = await readAgentStream(
              response,
              {
                sessionId: runSession.sessionId,
                runId,
                uiRevision,
              },
              signal,
              () => {
                signal.throwIfAborted();
                callbacks.view({ busy: true, status: "Checking the catalog…" });
              },
            );
            signal.throwIfAborted();
            unresolved = undefined;
            return outcome;
          } finally {
            signal.removeEventListener("abort", cancel);
          }
        },
      });
      const unsubscribe = observer.subscribe((result) => {
        if (active() && result.fetchStatus === "fetching") {
          callbacks.view({
            busy: result.fetchStatus === "fetching",
            status: "Finding products…",
          });
        }
      });
      const timer = setTimeout(() => {
        void client.cancelQueries({ queryKey, exact: true });
      }, 35_000);
      try {
        const result = await observer.refetch({ throwOnError: true });
        if (!active() || revision !== attemptRevision) return;
        const outcome = result.data;
        if (!outcome) throw new Error("Incomplete agent run");
        if ("status" in outcome) {
          callbacks.view({
            busy: false,
            status:
              outcome.status === "running"
                ? "Your previous request is still running. Send again to check its status."
                : outcome.status === "fallback"
                  ? fallbackStatus(outcome.reason)
                  : "Your previous request has ended. Your browsing is unchanged. Send your request again to start new guidance.",
          });
        } else if (outcome.batch && revision === uiRevision) {
          callbacks.apply(outcome.batch);
          history.push({ role: "user", content: recovery?.message ?? message });
          if (history.length > 8) history.shift();
          callbacks.view({
            busy: false,
            status: [...new Set(outcome.batch.limitations)].join(" "),
          });
        } else {
          callbacks.view({
            busy: false,
            status: fallbackStatus(outcome.reason),
          });
        }
      } catch {
        if (active())
          callbacks.view({
            busy: false,
            status: unresolved ? unresolvedStatus : unavailable,
          });
      } finally {
        clearTimeout(timer);
        unsubscribe();
        observer.destroy();
        client.removeQueries({ queryKey, exact: true });
        if (pending === current) pending = undefined;
      }
    },
    /** Preserve recovery metadata while direct browsing invalidates pending guidance. */
    interrupt() {
      stop();
      callbacks.view({ busy: false, status: ready });
    },
    /** Request server cancellation and retain uncertain runs if delivery fails. */
    cancel() {
      stop();
      callbacks.view({
        busy: false,
        status: "Request cancelled. Your browsing is unchanged.",
      });
    },
    /** Release visit-owned observers and in-memory credentials on teardown. */
    dispose() {
      disposed = true;
      stop();
      session = undefined;
      unresolved = undefined;
      history.length = 0;
    },
  };
}

/** Bound the UTF-8 payload by dropping oldest context; reject an oversized message. */
function serializeRequest(
  runId: string,
  uiRevision: number,
  message: string,
  history: { role: "user"; content: string }[],
) {
  const context = [...history];
  /** Rebuild after truncation so the measured bytes match the transmitted body. */
  const serialize = () =>
    JSON.stringify({ runId, uiRevision, message, context });
  let body = serialize();
  while (new TextEncoder().encode(body).byteLength > 32768) {
    if (!context.length) throw new Error("Shopping request too large");
    context.shift();
    body = serialize();
  }
  return body;
}

/** Explain a validated fallback consistently for streamed and recovered runs. */
function fallbackStatus(reason: string | undefined) {
  if (reason === "budget_exhausted")
    return "Shopping guidance has reached its monthly limit. You can still browse and choose products.";
  if (reason === "accounting_unavailable")
    return "Shopping guidance is temporarily unavailable. You can still browse products and use your bag. Try your request again later.";
  if (reason === "rate_limited")
    return "Please wait before asking again. You can still browse products.";
  return unavailable;
}
