import {
  type AgentBatch,
  batchSchema,
  eventSchema,
  fallbackEventSchema,
  progressSchema,
} from "./agent-contract";

/**
 * Parse at most 64 KiB of AG-UI SSE for the expected session/run/revision.
 * Reject malformed ordering, correlations or terminal outcomes, including trailing
 * data. Return a composition only after clean EOF; cancellation releases the reader.
 * The progress callback reports validated admission and consecutive invocations.
 */
export async function readAgentStream(
  response: Response,
  expected: { sessionId: string; runId: string; uiRevision: number },
  signal: AbortSignal,
  progress: () => void,
): Promise<{ batch?: AgentBatch; reason?: string }> {
  if (
    !response.headers.get("content-type")?.startsWith("text/event-stream") ||
    !response.body
  )
    throw new Error("Invalid agent stream");
  const reader = response.body.getReader();
  /** Unblock a pending read when the query is cancelled. */
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let size = 0;
  let started = false;
  let finished = false;
  let invocation = -1;
  let batch: AgentBatch | undefined;
  let reason: string | undefined;
  /** Reject data belonging to another run or a superseded UI revision. */
  const match = (value: { runId: string; uiRevision: number }) => {
    if (
      value.runId !== expected.runId ||
      value.uiRevision !== expected.uiRevision
    )
      throw new Error("Stale agent response");
  };
  /** Validate one complete frame before advancing the stream state machine. */
  const frame = (raw: string) => {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (finished) throw new Error("Event after completion");
    const event = eventSchema.parse(JSON.parse(data));
    if (event.type === "RUN_STARTED") {
      match({ runId: event.runId, uiRevision: event.metadata.uiRevision });
      if (started || event.threadId !== expected.sessionId)
        throw new Error("Invalid start");
      started = true;
      return;
    }
    if (!started) throw new Error("Missing start");
    if (event.type === "RUN_FINISHED") {
      match({ runId: event.runId, uiRevision: event.result.uiRevision });
      if (
        event.threadId !== expected.sessionId ||
        (event.result.status === "completed"
          ? !batch || reason || event.result.reason !== undefined
          : !reason || event.result.reason !== reason)
      )
        throw new Error("Invalid completion");
      finished = true;
    } else if (event.name === "lulu.progress.v1") {
      const value = progressSchema.parse(event.value);
      match(value);
      if (
        value.invocation !== invocation + 1 ||
        value.stage !== (invocation === -1 ? "admission" : "inference")
      )
        throw new Error("Invalid progress order");
      invocation = value.invocation;
      if (batch || reason) throw new Error("Late progress");
      progress();
    } else {
      if (invocation === -1) throw new Error("Missing admission");
      if (batch || reason) throw new Error("Duplicate outcome");
      if (event.name === "lulu.a2ui.v1") {
        batch = batchSchema.parse(event.value);
        match(batch);
      } else if (event.name === "lulu.fallback.v1") {
        const fallback = fallbackEventSchema.parse(event.value);
        match(fallback);
        reason = fallback.reason;
      } else throw new Error("Unsupported agent event");
    }
  };
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new Error("Agent stream too large");
      buffer += decoder.decode(value, { stream: true });
      // Normalize complete CRLF pairs without corrupting a split pair.
      buffer = buffer.replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        frame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() || !finished) throw new Error("Incomplete agent stream");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel();
    reader.releaseLock();
  }
  return { batch, reason };
}
