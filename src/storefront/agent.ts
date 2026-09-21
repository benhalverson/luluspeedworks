import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { AgentComposition } from "./agent-contract";
import { requestGuidance } from "./agent-transport";
import { apiOrigin } from "./auth";

export function useShoppingAgent(
  apply: (composition: AgentComposition) => void,
) {
  const revision = useRef(0);
  const active = useRef<AbortController | null>(null);
  const mutation = useMutation({
    retry: false,
    mutationFn: (input: {
      message: string;
      runId: string;
      uiRevision: number;
      controller: AbortController;
    }) =>
      requestGuidance(
        apiOrigin,
        {
          message: input.message,
          runId: input.runId,
          uiRevision: input.uiRevision,
        },
        input.controller.signal,
      ),
    onSuccess: (composition, input) => {
      if (
        input.uiRevision === revision.current &&
        !input.controller.signal.aborted
      )
        apply(composition);
    },
  });
  const reset = mutation.reset;
  const interrupt = useCallback(() => {
    revision.current += 1;
    active.current?.abort();
    active.current = null;
    reset();
  }, [reset]);
  useEffect(() => () => active.current?.abort(), []);
  return {
    interrupt,
    send(message: string) {
      interrupt();
      const controller = new AbortController();
      active.current = controller;
      mutation.mutate({
        message,
        runId: crypto.randomUUID(),
        uiRevision: revision.current,
        controller,
      });
    },
    busy: mutation.isPending,
    status: mutation.isPending
      ? "Finding catalog guidance…"
      : mutation.isSuccess
        ? "Catalog guidance is ready. Follow a product link to choose its options."
        : mutation.isError
          ? mutation.error.message ===
            "Shopping guidance has reached its monthly budget. Browse with the controls below."
            ? mutation.error.message
            : "Shopping guidance is unavailable. You can keep browsing or try again."
          : "Ask about catalog items. Use the direct controls any time.",
  };
}
