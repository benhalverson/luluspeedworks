import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { apiOrigin } from "../storefront/auth";
import {
  type ProductDraft,
  type ProductDraftTarget,
  productDraftResponseSchema,
  productDraftTargetSchema,
} from "./contracts";
import { DraftRequestError, draftRequest } from "./request";

const creationSchema = z
  .object({ requestKey: z.string().uuid(), target: productDraftTargetSchema })
  .strict();
type Creation = z.infer<typeof creationSchema>;
type Stored = Creation | null | "invalid";
type Accept = (draft: ProductDraft) => void;
type Guard = () => void;

/** Corrupt recovery storage must never silently allocate a replacement identity. */
function decode(value: string): Stored {
  try {
    return creationSchema.nullable().parse(JSON.parse(value));
  } catch {
    return "invalid";
  }
}

/** Persist only initial target identifiers; saved answers remain on the owned server draft. */
export function useDraftCreation(identity: string) {
  const key = `lulu-admin-create-v1:${apiOrigin}:${identity}`;
  const [pending, setPending] = useLocalStorage<Stored>(key, null, {
    deserializer: decode,
  });
  const [retryKey, setRetryKey] = useState<string | null>(null);
  function read() {
    const value = decode(localStorage.getItem(key) ?? "null");
    if (value === "invalid")
      throw new Error(
        "Saved conversation recovery is unreadable. Contact the store before starting another conversation.",
      );
    return value;
  }
  function persist(value: Creation | null) {
    setPending(value);
    if (localStorage.getItem(key) !== JSON.stringify(value))
      throw new Error(
        "Conversation recovery storage is unavailable. Keep the existing request.",
      );
  }
  async function locked<T>(guard: Guard, work: () => Promise<T>) {
    if (!navigator.locks)
      throw new Error("Conversation creation requires secure browser locks.");
    return navigator.locks.request(key, async () => {
      guard();
      return work();
    });
  }
  function finish(
    current: Creation,
    next: ProductDraft,
    accept: Accept,
    guard: Guard,
  ) {
    guard();
    if (
      next.status !== "active" ||
      JSON.stringify(next.target) !== JSON.stringify(current.target) ||
      JSON.stringify(read()) !== JSON.stringify(current)
    )
      throw new Error(
        "The recovered conversation does not match this request. Keep its recovery information.",
      );
    accept(next);
    persist(null);
    setRetryKey(null);
  }
  async function begin(
    target: ProductDraftTarget,
    accept: Accept,
    guard: Guard,
    started: () => void,
  ) {
    return locked(guard, async () => {
      if (read())
        throw new Error(
          "Recover the pending conversation before starting another.",
        );
      const current = { requestKey: crypto.randomUUID(), target };
      persist(current);
      setRetryKey(null);
      started();
      const next = await draftRequest(
        "",
        productDraftResponseSchema,
        "POST",
        current,
      );
      finish(current, next, accept, guard);
    });
  }
  async function recover(
    accept: Accept,
    guard: Guard,
  ): Promise<"found" | "missing" | "discarded"> {
    return locked(guard, async () => {
      const current = read();
      if (!current)
        throw new Error(
          "No pending conversation request. Refresh saved conversations.",
        );
      setRetryKey(null);
      let next: ProductDraft;
      try {
        next = await draftRequest(
          `/by-request-key/${current.requestKey}`,
          productDraftResponseSchema,
        );
      } catch (error) {
        guard();
        if (JSON.stringify(read()) !== JSON.stringify(current))
          throw new Error(
            "The pending conversation request changed. Reload its saved state.",
          );
        if (error instanceof DraftRequestError && error.status === 404) {
          setRetryKey(current.requestKey);
          return "missing";
        }
        if (error instanceof DraftRequestError && error.status === 410) {
          persist(null);
          return "discarded";
        }
        throw error;
      }
      finish(current, next, accept, guard);
      return "found";
    });
  }
  async function retry(accept: Accept, guard: Guard) {
    return locked(guard, async () => {
      const current = read();
      if (!current || current.requestKey !== retryKey)
        throw new Error(
          "Check the original conversation request before retrying it.",
        );
      const next = await draftRequest(
        "",
        productDraftResponseSchema,
        "POST",
        current,
      );
      finish(current, next, accept, guard);
    });
  }
  return {
    pending,
    begin,
    recover,
    retry,
    canRetry:
      pending !== null &&
      pending !== "invalid" &&
      pending.requestKey === retryKey,
  };
}
