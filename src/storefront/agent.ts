import { type QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  type AgentAccess,
  type AgentCommerce,
  readAgentCart,
} from "./agent-commerce";
import {
  type AgentBatch,
  type AgentSession,
  runStatusSchema,
  sessionSchema,
} from "./agent-contract";
import { type PendingRun, recoveryStorage } from "./agent-recovery";
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
    commerce?: AgentCommerce;
  },
) {
  let session: AgentSession | undefined;
  const visitId = crypto.randomUUID();
  let pending: { queryKey: readonly string[] } | undefined;
  let unresolved: PendingRun | undefined;
  let revision = 0;
  let disposed = false;
  const history: { role: "user"; content: string }[] = [];
  /** Send header-only visit credentials; never persist capabilities in the query cache. */
  const post = (
    path: string,
    signal: AbortSignal,
    visit?: AgentSession,
    body?: string,
    access?: AgentAccess,
  ) =>
    fetch(new URL(path, origin), {
      method: "POST",
      credentials: access?.accountId ? "include" : "omit",
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(visit ? { Authorization: `Bearer ${visit.capability}` } : {}),
        ...(access?.guestToken ? { "X-Cart-Token": access.guestToken } : {}),
        ...(access?.accountId
          ? { "X-Expected-Account-Id": access.accountId }
          : {}),
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
      if (!callbacks.commerce) return send(message);
      const owner = callbacks.commerce.owner();
      if (owner === undefined) {
        callbacks.view({
          busy: false,
          status: "Wait for your session to finish loading.",
        });
        return;
      }
      try {
        if (!navigator.locks)
          throw Error("Shopping requires secure browser locks");
        const storage = recoveryStorage(origin, owner);
        await navigator.locks.request(storage.key, async () => {
          if (disposed || callbacks.commerce?.owner() !== owner) return;
          unresolved = storage.read();
          await send(message, storage, owner);
        });
      } catch {
        if (!disposed)
          callbacks.view({ busy: false, status: unresolvedStatus });
      }
    },
    /** Preserve recovery metadata while direct browsing invalidates pending guidance. */
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
    reset() {
      stop();
      session = undefined;
      unresolved = undefined;
      history.length = 0;
    },
    dispose() {
      disposed = true;
      stop();
      session = undefined;
      unresolved = undefined;
      history.length = 0;
    },
  };
  async function send(
    message: string,
    storage?: ReturnType<typeof recoveryStorage>,
    owner?: string | null,
  ) {
    stop(false);
    const recovery = unresolved;
    const runId = recovery?.runId ?? crypto.randomUUID();
    const queryKey = ["shopping-stream", visitId, runId, crypto.randomUUID()];
    const current = { queryKey };
    pending = current;
    const uiRevision = recovery?.uiRevision ?? ++revision;
    const attemptRevision = revision;
    /** Only the latest live attempt may publish view or surface changes. */
    const active = () =>
      !disposed &&
      pending === current &&
      (!callbacks.commerce || callbacks.commerce.owner() === owner);
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
        let access: AgentAccess | undefined;
        async function reconcile(run: PendingRun) {
          if (callbacks.commerce) {
            if (!active()) throw Error("Shopping visit changed");
            if (run.access?.cartId) {
              if (recovery)
                await readAgentCart(origin, run.access, signal, {
                  sessionId: run.session.sessionId,
                  runId: run.runId,
                });
              await readAgentCart(origin, run.access, signal);
            }
            signal.throwIfAborted();
            if (!active()) throw Error("Shopping visit changed");
            await callbacks.commerce.refresh();
            signal.throwIfAborted();
            if (!active()) throw Error("Shopping account changed");
            storage?.clear(run.runId);
          }
          unresolved = undefined;
        }
        /** Best-effort cancellation also tombstones requests that have not reached the server. */
        const cancel = () => {
          if (runSession) {
            void post(
              `/agent/sessions/${runSession.sessionId}/runs/${runId}/cancel`,
              AbortSignal.timeout(5000),
              runSession,
              undefined,
              access,
            ).catch(() => {});
          }
        };
        signal.addEventListener("abort", cancel, { once: true });
        try {
          runSession = recovery?.session ?? (await getSession(signal));
          signal.throwIfAborted();
          access =
            recovery?.access ?? (await callbacks.commerce?.prepare(signal));
          signal.throwIfAborted();
          if (callbacks.commerce && access?.accountId !== owner)
            throw Error("Shopping account changed");
          const cart =
            !recovery && access?.cartId
              ? await readAgentCart(origin, access, signal)
              : undefined;
          signal.throwIfAborted();
          const run = recovery ?? {
            runId,
            uiRevision,
            session: runSession,
            body: serializeRequest(runId, uiRevision, message, history, {
              ...(cart
                ? { cart: { id: cart.cartId, revision: cart.revision } }
                : {}),
              ...(access?.selection ? { selection: access.selection } : {}),
            }),
            ...(access ? { access } : {}),
            message,
          };
          unresolved = run;
          storage?.write(run);
          const response = await post(
            `/agent/sessions/${runSession.sessionId}/runs`,
            signal,
            runSession,
            run.body,
            access,
          );
          signal.throwIfAborted();
          if (
            !callbacks.commerce &&
            (response.status === 401 || response.status === 410)
          ) {
            session = undefined;
            unresolved = undefined;
          }
          if (callbacks.commerce && [401, 403, 409].includes(response.status))
            window.dispatchEvent(new Event(`lulu-cart-expired:${origin}`));
          if (!response.ok) throw new Error("Run unavailable");
          if (
            response.headers.get("content-type")?.startsWith("application/json")
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
            if (status.status !== "running") await reconcile(run);
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
          if (
            outcome.effects?.some((effect) =>
              "accountId" in effect
                ? effect.accountId !== access?.accountId
                : effect.status === "applied" &&
                  (effect.cart.cartId !== access?.cartId ||
                    effect.appliedRevision > effect.cart.revision),
            )
          ) {
            window.dispatchEvent(new Event(`lulu-cart-expired:${origin}`));
            throw Error("Unowned shopping result");
          }
          await reconcile(run);
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
      } else if (
        (!recovery || !callbacks.commerce) &&
        outcome.batch &&
        revision === uiRevision
      ) {
        if (outcome.effects?.length) {
          if (!callbacks.commerce) throw Error("Unowned shopping result");
          await callbacks.commerce.apply(outcome.effects);
          if (!active() || revision !== attemptRevision) return;
        }
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
  }
}

/** Bound the UTF-8 payload by dropping oldest context; reject an oversized message. */
function serializeRequest(
  runId: string,
  uiRevision: number,
  message: string,
  history: { role: "user"; content: string }[],
  commerce: object,
) {
  const context = [...history];
  /** Rebuild after truncation so the measured bytes match the transmitted body. */
  const serialize = () =>
    JSON.stringify({ runId, uiRevision, message, context, ...commerce });
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
