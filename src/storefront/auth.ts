import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { z } from "zod";

export const apiOrigin =
  import.meta.env.VITE_API_ORIGIN || "https://api.benhalverson.dev";
export const authClient = createAuthClient({
  baseURL: apiOrigin,
  plugins: [passkeyClient()],
  fetchOptions: {
    credentials: "include",
    cache: "no-store",
    retry: 0,
    timeout: 10_000,
    customFetchImpl: (...args) => fetch(...args),
  },
});
export const accountFields = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password.").max(128),
  name: z.string().trim().max(100),
});
export type AccountFields = z.infer<typeof accountFields>;
export const signupFields = accountFields.extend({
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});

// Only known storefront destinations may survive authentication.
export function returnDestination(value: string | null) {
  if (
    !value ||
    !/^\/(?:$|admin\/products\/?$|products\/[1-9]\d*\/?$|profile\/?$|cart\/?$|checkout\/?$|orders(?:\/[A-Za-z0-9-]+)?\/?$)/.test(
      value,
    )
  )
    return "/";
  return value;
}

export async function confirmSession() {
  const result = await authClient.getSession({
    query: { disableCookieCache: true },
  });
  if (result.error || !result.data?.user.id)
    throw new Error(
      "Your session could not be confirmed. Please sign in again.",
    );
  return result.data.user;
}

export async function authenticate(
  kind: "signin" | "signup" | "passkey",
  values: AccountFields,
) {
  const methods = {
    passkey: () => authClient.signIn.passkey(),
    signup: () =>
      authClient.signUp.email({
        ...signupFields.parse(values),
        name: values.name.trim() || values.email.trim(),
      }),
    signin: () =>
      authClient.signIn.email({
        email: values.email.trim(),
        password: values.password,
      }),
  };
  const result = await methods[kind]();
  if (result.error)
    throw new Error(
      kind === "passkey"
        ? "Passkey sign-in was cancelled or unavailable. Try again or use your password."
        : "Sign-in failed. Check your details and try again.",
    );
  return confirmSession();
}
