import {
  type AgentBatch,
  type AgentSession,
  sessionSchema,
} from "./agent-contract";
import { readAgentStream } from "./agent-stream";

export type AgentView = { busy: boolean; status: string };
const ready =
  "Ask about products. Choose colors and add to your bag using the product controls.";
const unavailable =
  "Shopping guidance is unavailable. Your browsing is unchanged. You can send your request again.";

/** One in-memory anonymous visit. No automatic retry can initiate paid work. */
export function createShoppingAgent(
  origin: string,
  callbacks: {
    view: (view: AgentView) => void;
    apply: (batch: AgentBatch) => void;
  },
) {
  let session: AgentSession | undefined;
  let pending:
    | { abort: AbortController; runId: string; session?: AgentSession }
    | undefined;
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
    current.abort.abort();
    if (current.session) {
      void post(
        `/agent/sessions/${current.session.sessionId}/runs/${current.runId}/cancel`,
        AbortSignal.timeout(5000),
        current.session,
      ).catch(() => {});
    }
  }
  return {
    async send(message: string) {
      stop();
      const current = {
        abort: new AbortController(),
        runId: crypto.randomUUID(),
        session: undefined as AgentSession | undefined,
      };
      pending = current;
      const uiRevision = revision;
      const active = () => !disposed && pending === current;
      const timer = setTimeout(() => current.abort.abort(), 35_000);
      callbacks.view({ busy: true, status: "Finding products…" });
      try {
        if (
          !session ||
          Math.min(session.expiresAt, session.absoluteExpiresAt) <= Date.now()
        ) {
          const response = await post("/agent/sessions", current.abort.signal);
          if (!response.ok) throw new Error("Session unavailable");
          const created = sessionSchema.parse(await response.json());
          if (!active()) return;
          session = created;
        }
        current.session = session;
        const context = [...history];
        const serialize = () =>
          JSON.stringify({
            runId: current.runId,
            uiRevision,
            message,
            context,
          });
        let body = serialize();
        while (new TextEncoder().encode(body).byteLength > 32768) {
          if (!context.length) throw new Error("Shopping request too large");
          context.shift();
          body = serialize();
        }
        const response = await post(
          `/agent/sessions/${session.sessionId}/runs`,
          current.abort.signal,
          session,
          body,
        );
        if (response.status === 401 || response.status === 410)
          session = undefined;
        if (!response.ok) throw new Error("Run unavailable");
        const outcome = await readAgentStream(
          response,
          {
            sessionId: current.session.sessionId,
            runId: current.runId,
            uiRevision,
          },
          () => {
            current.abort.signal.throwIfAborted();
            callbacks.view({ busy: true, status: "Checking the catalog…" });
          },
          current.abort.signal,
        );
        current.abort.signal.throwIfAborted();
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
