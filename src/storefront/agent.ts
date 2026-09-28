import {
  experimental_streamedQuery,
  type QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import {
  type AgentBatch,
  type AgentSession,
  sessionSchema,
} from "./agent-contract";
import { type AgentStreamState, readAgentStream } from "./agent-stream";

export type AgentView = { busy: boolean; status: string };
const ready =
  "Ask about products. Choose colors and add to your bag using the product controls.";
const unavailable =
  "Shopping guidance is unavailable. Your browsing is unchanged. You can send your request again.";

/** One in-memory anonymous visit. No automatic retry can initiate paid work. */
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
  let revision = 0;
  let disposed = false;
  const history: { role: "user"; content: string }[] = [];
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
  function stop() {
    revision++;
    const current = pending;
    pending = undefined;
    if (!current) return;
    void client.cancelQueries({ queryKey: current.queryKey, exact: true });
  }
  return {
    async send(message: string) {
      stop();
      const runId = crypto.randomUUID();
      const queryKey = ["shopping-stream", visitId, runId];
      const current = { queryKey };
      pending = current;
      const uiRevision = revision;
      const active = () => !disposed && pending === current;
      // A successful refetch always enters streamFn before returning data.
      let transportSignal!: AbortSignal;
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
        queryFn: experimental_streamedQuery<
          AgentStreamState,
          AgentStreamState | null
        >({
          initialValue: null,
          reducer: (_previous, next) => next,
          streamFn: async function* ({ signal }) {
            transportSignal = signal;
            let runSession: AgentSession | undefined;
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
              if (
                !session ||
                Math.min(session.expiresAt, session.absoluteExpiresAt) <=
                  Date.now()
              ) {
                const response = await post("/agent/sessions", signal);
                if (!response.ok) throw new Error("Session unavailable");
                const created = sessionSchema.parse(await response.json());
                signal.throwIfAborted();
                session = created;
              }
              runSession = session;
              const context = [...history];
              const serialize = () =>
                JSON.stringify({
                  runId,
                  uiRevision,
                  message,
                  context,
                });
              let body = serialize();
              while (new TextEncoder().encode(body).byteLength > 32768) {
                if (!context.length)
                  throw new Error("Shopping request too large");
                context.shift();
                body = serialize();
              }
              const response = await post(
                `/agent/sessions/${session.sessionId}/runs`,
                signal,
                session,
                body,
              );
              signal.throwIfAborted();
              if (response.status === 401 || response.status === 410)
                session = undefined;
              if (!response.ok) throw new Error("Run unavailable");
              yield* readAgentStream(
                response,
                {
                  sessionId: runSession.sessionId,
                  runId,
                  uiRevision,
                },
                signal,
              );
            } finally {
              signal.removeEventListener("abort", cancel);
            }
          },
        }),
      });
      const unsubscribe = observer.subscribe((result) => {
        if (active() && result.fetchStatus === "fetching") {
          callbacks.view({
            busy: result.fetchStatus === "fetching",
            status: result.data ? "Checking the catalog…" : "Finding products…",
          });
        }
      });
      const timer = setTimeout(() => {
        void client.cancelQueries({ queryKey, exact: true });
      }, 35_000);
      try {
        const result = await observer.refetch({ throwOnError: true });
        if (!active() || revision !== uiRevision) return;
        // Cancellation can resolve with the last streamed cache value.
        transportSignal.throwIfAborted();
        const outcome = result.data;
        if (outcome?.type !== "outcome")
          throw new Error("Incomplete agent run");
        if (outcome.batch) {
          callbacks.apply(outcome.batch);
          history.push({ role: "user", content: message });
          if (history.length > 8) history.shift();
          callbacks.view({
            busy: false,
            status: [...new Set(outcome.batch.limitations)].join(" "),
          });
        } else {
          callbacks.view({
            busy: false,
            status:
              outcome.reason === "budget_exhausted"
                ? "Shopping guidance has reached its monthly limit. You can still browse and choose products."
                : outcome.reason === "rate_limited"
                  ? "Please wait before asking again. You can still browse products."
                  : unavailable,
          });
        }
      } catch {
        if (active()) callbacks.view({ busy: false, status: unavailable });
      } finally {
        clearTimeout(timer);
        unsubscribe();
        observer.destroy();
        client.removeQueries({ queryKey, exact: true });
        if (pending === current) pending = undefined;
      }
    },
    interrupt() {
      stop();
      callbacks.view({ busy: false, status: ready });
    },
    cancel() {
      stop();
      callbacks.view({
        busy: false,
        status: "Request cancelled. Your browsing is unchanged.",
      });
    },
    dispose() {
      disposed = true;
      stop();
      session = undefined;
      history.length = 0;
    },
  };
}
