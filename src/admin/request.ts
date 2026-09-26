import { z } from "zod";
import { apiOrigin } from "../storefront/auth";

export class DraftRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public source: "draft" | "transfer" = "draft",
  ) {
    super(message);
  }
}

export function isAuthorizationFailure(
  error: unknown,
): error is DraftRequestError {
  return (
    error instanceof DraftRequestError &&
    error.source === "draft" &&
    (error.status === 401 || error.status === 403)
  );
}

export async function draftRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    new URL(`/admin/product-drafts${path}`, apiOrigin),
    {
      method,
      credentials: "include",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    },
  );
  if (!response.ok) {
    const result = z
      .object({ error: z.string() })
      .safeParse(await response.json().catch(() => null));
    throw new DraftRequestError(
      response.status,
      result.success
        ? result.data.error
        : `Draft request failed (${response.status}).`,
    );
  }
  return schema.parse(await response.json());
}
