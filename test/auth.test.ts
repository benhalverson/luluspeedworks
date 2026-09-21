import { beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  getSession: vi.fn(),
  signIn: { email: vi.fn(), passkey: vi.fn() },
  signUp: { email: vi.fn() },
}));
const createClient = vi.hoisted(() => vi.fn(() => sdk));
vi.mock("better-auth/react", () => ({ createAuthClient: createClient }));
vi.mock("@better-auth/passkey/client", () => ({
  passkeyClient: () => ({ id: "passkey" }),
}));

import {
  accountFields,
  authenticate,
  confirmSession,
  returnDestination,
  signupFields,
} from "../src/storefront/auth";

const values = {
  email: " ben@example.com ",
  password: "test password",
  name: "Ben",
};
beforeEach(() => {
  sdk.getSession.mockResolvedValue({
    data: { user: { id: "user-1", email: "ben@example.com" } },
    error: null,
  });
  sdk.signIn.email.mockResolvedValue({ error: null });
  sdk.signIn.passkey.mockResolvedValue({ error: null });
  sdk.signUp.email.mockResolvedValue({ error: null });
});
it("delegates password, signup and passkey flows and confirms the resulting session", async () => {
  await authenticate("signin", values);
  expect(sdk.signIn.email).toHaveBeenCalledWith({
    email: "ben@example.com",
    password: values.password,
  });
  await authenticate("signup", values);
  expect(sdk.signUp.email).toHaveBeenCalledWith({
    ...values,
    email: "ben@example.com",
  });
  await authenticate("signup", { ...values, name: " " });
  expect(sdk.signUp.email).toHaveBeenLastCalledWith({
    ...values,
    email: "ben@example.com",
    name: "ben@example.com",
  });
  expect(await authenticate("passkey", values)).toMatchObject({ id: "user-1" });
  expect(sdk.signIn.passkey).toHaveBeenCalledWith();
  expect(sdk.getSession).toHaveBeenCalledWith({
    query: { disableCookieCache: true },
  });
});
it("does not treat a cancelled passkey, rejected credentials or missing session as success", async () => {
  sdk.signIn.passkey.mockResolvedValue({ error: { code: "AUTH_CANCELLED" } });
  await expect(authenticate("passkey", values)).rejects.toThrow("cancelled");
  sdk.signIn.email.mockResolvedValue({
    error: { message: "private server details" },
  });
  await expect(authenticate("signin", values)).rejects.toThrow(
    "Check your details",
  );
  sdk.getSession.mockResolvedValue({ error: { status: 401 }, data: null });
  await expect(confirmSession()).rejects.toThrow("could not be confirmed");
  sdk.getSession.mockResolvedValue({ error: null, data: null });
  await expect(confirmSession()).rejects.toThrow("could not be confirmed");
  sdk.getSession.mockResolvedValue({ error: null, data: { user: { id: "" } } });
  await expect(confirmSession()).rejects.toThrow("could not be confirmed");
});
it("allows only local known destinations and preserves legacy short signin passwords", () => {
  for (const destination of [
    "/",
    "/products/12",
    "/cart",
    "/checkout",
    "/orders",
    "/orders/abc-12",
  ])
    expect(returnDestination(destination)).toBe(destination);
  for (const destination of [
    null,
    "",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "/signin",
    "/admin",
    "/products/1?redirect=evil",
    "/orders/../admin",
  ])
    expect(returnDestination(destination)).toBe("/");
  expect(
    accountFields.safeParse({ ...values, password: "short" }).success,
  ).toBe(true);
  expect(signupFields.safeParse({ ...values, password: "short" }).success).toBe(
    false,
  );
});
