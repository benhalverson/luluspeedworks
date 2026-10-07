import { z } from "zod";
import { selectionSchema } from "./agent-commerce";
import { sessionSchema } from "./agent-contract";

export const pendingRunSchema = z
  .object({
    runId: z.string().uuid(),
    uiRevision: z.number().int().nonnegative().safe(),
    session: sessionSchema,
    body: z.string().max(32768),
    message: z.string().max(8192),
    access: z
      .object({
        accountId: z.string().nullable(),
        cartId: z.string().uuid().optional(),
        guestToken: z.string().uuid().optional(),
        selection: selectionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PendingRun = z.infer<typeof pendingRunSchema>;
/** Only unresolved requests persist; a new visit never restores completed conversation history. */
export function recoveryStorage(origin: string, owner: string | null) {
  const key = `lulu-agent-run-v1:${origin}:${JSON.stringify(owner)}`;
  return {
    key,
    read() {
      const value = localStorage.getItem(key);
      if (value === null) return undefined;
      const pending = pendingRunSchema.parse(JSON.parse(value));
      if (!pending.access || pending.access.accountId !== owner)
        throw Error("Shopping recovery owner changed");
      const body = JSON.parse(pending.body);
      if (
        body.runId !== pending.runId ||
        body.uiRevision !== pending.uiRevision ||
        body.cart?.id !== pending.access.cartId
      )
        throw Error("Shopping recovery request changed");
      return pending;
    },
    write(run: PendingRun) {
      const serialized = JSON.stringify(run);
      localStorage.setItem(key, serialized);
      if (localStorage.getItem(key) !== serialized)
        throw Error("Shopping recovery storage unavailable");
    },
    clear(runId: string) {
      const current = this.read();
      if (current?.runId !== runId)
        throw Error("Shopping recovery request changed");
      localStorage.removeItem(key);
      if (localStorage.getItem(key) !== null)
        throw Error("Shopping recovery storage unavailable");
    },
  };
}
