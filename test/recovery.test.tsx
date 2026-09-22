import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { authClient } from "../src/storefront/auth";
import { resetCallback } from "../src/storefront/recovery";
import { renderWithClient, testClient } from "./query-client";

vi.mock("../src/storefront/auth", async (original) => {
  const actual = await original<typeof import("../src/storefront/auth")>();
  return {
    ...actual,
    authClient: {
      useSession: vi.fn(actual.authClient.useSession),
      $store: actual.authClient.$store,
      requestPasswordReset: actual.authClient.requestPasswordReset,
      resetPassword: actual.authClient.resetPassword,
    },
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(authClient.useSession).mockReset();
});

function visit(path: string, client = testClient()) {
  window.history.replaceState(null, "", path);
  return renderWithClient(
    <StrictMode>
      <App />
    </StrictMode>,
    client,
  );
}
function fill(email = "ben@example.com") {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: email },
  });
}
function passwords(password = " new password ", confirmation = password) {
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirmation },
  });
}
function submit(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
function mockApi(status = 200, code = "FAILURE") {
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).includes("get-session")
      ? Response.json(null)
      : Response.json(
          status === 200
            ? { status: true }
            : { code, message: "private server details" },
          { status },
        ),
  );
}
function posts() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "POST");
}

it.each(["http://localhost:3000", "https://luluspeedworks.com"])(
  "constructs callbacks at %s and sanitizes unsafe destinations",
  (origin) => {
    expect(resetCallback(origin, "/products/12")).toBe(
      `${origin}/reset-password?returnTo=%2Fproducts%2F12`,
    );
    for (const unsafe of [
      null,
      "//evil.com",
      "https://evil.com",
      "/reset-password?token=secret",
      "/signin",
      "/%2f/evil.com",
    ]) {
      expect(resetCallback(origin, unsafe)).toBe(
        `${origin}/reset-password?returnTo=%2F`,
      );
    }
  },
);

it("validates email, posts the exact SDK request, and offers generic confirmation and explicit resend", async () => {
  mockApi();
  visit("/forgot-password?returnTo=%2Fproducts%2F12");
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  submit("Send reset link");
  await screen.findByText("Enter a valid email address.");
  expect(posts()).toHaveLength(0);
  fill(" ben@example.com ");
  submit("Send reset link");
  await screen.findByText(
    "If this email exists in our system, check your email for the reset link.",
  );
  expect(screen.getByText(/expires in one hour/)).toBeVisible();
  expect(posts()).toHaveLength(1);
  expect(String(posts()[0]?.[0])).toBe(
    "https://api.benhalverson.dev/api/auth/request-password-reset",
  );
  expect(JSON.parse(String(posts()[0]?.[1]?.body))).toEqual({
    email: "ben@example.com",
    redirectTo: `${window.location.origin}/reset-password?returnTo=%2Fproducts%2F12`,
  });
  expect(posts()[0]?.[1]?.credentials).toBe("include");
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/signin?returnTo=%2Fproducts%2F12",
  );
  submit("Request another email");
  expect(screen.getByLabelText("Email")).toHaveValue("");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([url]) => String(url).includes("/api/auth/")),
  ).toBe(true);
});

it.each([
  "/reset-password",
  "/reset-password?token=&returnTo=//evil.com",
  "/reset-password?token=secret&error=INVALID_TOKEN",
])("handles direct invalid callback %s on refresh", async (path) => {
  mockApi();
  const view = visit(path);
  expect(screen.getByRole("alert")).toHaveTextContent(
    /missing, invalid, or expired/,
  );
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Request another email" }),
  ).toHaveAttribute("href", "/forgot-password?returnTo=%2F");
  view.unmount();
  visit(path);
  expect(screen.getByRole("alert")).toHaveTextContent(
    /missing, invalid, or expired/,
  );
});

it("validates password length and confirmation without sending credentials", async () => {
  mockApi();
  visit("/reset-password?token=secret");
  passwords("short");
  submit("Reset password");
  await screen.findByText("Use at least 8 characters.");
  passwords("x".repeat(129));
  submit("Reset password");
  await screen.findByText(/at most 128/);
  passwords("password123", "different");
  submit("Reset password");
  await screen.findByText("Passwords must match.");
  expect(posts()).toHaveLength(0);
  expect(screen.getByLabelText("New password")).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
});

it("resets for signed-in visitors, replaces the token URL, clears private cache, and preserves saved bags", async () => {
  const sessionData = {
    user: { id: "user-1", email: "ben@example.com" },
    session: { id: "session-1" },
  };
  let resetDone = false;
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes("get-session"))
      return Response.json(resetDone ? null : sessionData);
    resetDone = true;
    return Response.json({ status: true });
  });
  const key = "lulu-cart-v2:https://api.benhalverson.dev";
  localStorage.setItem(
    key,
    JSON.stringify({ cartId: "saved-bag", ownerId: "user-1" }),
  );
  const saved = localStorage.getItem(key);
  const client = testClient();
  client.setQueryData(["profile", "user-1"], { private: true });
  visit("/reset-password?token=secret&returnTo=%2Fcheckout#secret", client);
  await act(async () => authClient.$store.atoms.session?.get().refetch());
  await waitFor(() =>
    expect(authClient.$store.atoms.session?.get().data?.user.id).toBe("user-1"),
  );
  passwords();
  submit("Reset password");
  await screen.findByText(
    "Your password has been reset. Sign in with your new password.",
  );
  expect(posts()).toHaveLength(1);
  expect(String(posts()[0]?.[0])).toContain("/api/auth/reset-password");
  expect(JSON.parse(String(posts()[0]?.[1]?.body))).toEqual({
    token: "secret",
    newPassword: " new password ",
  });
  expect(location.search).toBe("?returnTo=%2Fcheckout");
  expect(location.hash).toBe("");
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(localStorage.getItem(key)).toBe(saved);
  expect(localStorage.length).toBe(1);
  expect(sessionStorage.length).toBe(0);
  expect(authClient.$store.atoms.session?.get().data).toBeNull();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) =>
        String(url).includes("disableCookieCache=true"),
      ),
  ).toBe(true);
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/signin?returnTo=%2Fcheckout",
  );
  expect(
    client
      .getMutationCache()
      .getAll()
      .every((mutation) => mutation.state.variables === undefined),
  ).toBe(true);
});

it.each(["request", "reset"])(
  "prevents duplicate %s submissions while pending",
  async (mode) => {
    let finish = (_value: Response) => {};
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes("get-session")
        ? Response.json(null)
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    );
    const request = mode === "request";
    visit(request ? "/forgot-password" : "/reset-password?token=secret");
    if (request) fill();
    else passwords();
    const button = screen.getByRole("button", {
      name: request ? "Send reset link" : "Reset password",
    });
    const form = button.closest("form");
    if (!form) throw new Error("Missing form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(button).toBeDisabled());
    expect(posts()).toHaveLength(1);
    expect(
      screen.getByLabelText(request ? "Email" : "New password"),
    ).toBeDisabled();
    await act(async () => finish(Response.json({ status: true })));
    await screen.findByRole("status");
  },
);

it.each([
  ["request", 429, "RATE_LIMIT", "Too many attempts"],
  ["request", 503, "PROVIDER_FAILURE", "temporarily unavailable"],
  ["request", 400, "BAD_REQUEST", "temporarily unavailable"],
  ["reset", 429, "RATE_LIMIT", "Too many attempts"],
  ["reset", 400, "INVALID_TOKEN", "expired or has already been used"],
  ["reset", 400, "PASSWORD_TOO_SHORT", "Check the 8–128"],
  ["reset", 422, "PASSWORD_TOO_LONG", "Check the 8–128"],
  ["reset", 500, "INTERNAL_ERROR", "temporarily unavailable"],
] as const)(
  "handles %s HTTP %s / %s without retries",
  async (mode, status, code, message) => {
    mockApi(status, code);
    visit(
      mode === "request" ? "/forgot-password" : "/reset-password?token=secret",
    );
    if (mode === "request") fill();
    else passwords();
    submit(mode === "request" ? "Send reset link" : "Reset password");
    await screen.findByText(new RegExp(message));
    expect(posts()).toHaveLength(1);
    expect(
      screen.queryByText("private server details"),
    ).not.toBeInTheDocument();
  },
);

it.each(["request", "reset"])(
  "reports uncertain %s network failures without claiming failure to send/change",
  async (mode) => {
    visit(
      mode === "request" ? "/forgot-password" : "/reset-password?token=secret",
    );
    if (mode === "request") fill();
    else passwords();
    submit(mode === "request" ? "Send reset link" : "Reset password");
    await screen.findByText(
      mode === "request"
        ? /An email may still arrive/
        : /Try signing in with your new password/,
    );
    expect(posts()).toHaveLength(1);
  },
);

it("keeps successful reset confirmation when the SDK session refresh reports an error", async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).includes("get-session")
      ? Response.json({ message: "offline" }, { status: 503 })
      : Response.json({ status: true }),
  );
  visit("/reset-password?token=secret");
  passwords();
  submit("Reset password");
  await screen.findByText(/password was changed, but/);
  expect(location.search).not.toContain("token");
  expect(screen.getByRole("status")).toHaveTextContent(
    /password has been reset/,
  );
});

it("times out a stalled email request without retrying or claiming no email was sent", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).includes("get-session")) return Response.json(null);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Timeout", "AbortError")),
        );
      });
    });
    visit("/forgot-password");
    fill();
    await act(async () => submit("Send reset link"));
    expect(
      screen.getByRole("button", { name: "Requesting email…" }),
    ).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(10_001));
    expect(screen.getByText(/An email may still arrive/)).toBeVisible();
    expect(posts()).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("shows reset success while session refresh is still pending", async () => {
  mockApi();
  let finish = () => {};
  const refetch = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  vi.mocked(authClient.useSession).mockReturnValue({
    data: null,
    error: null,
    isPending: false,
    isRefetching: true,
    refetch,
  });
  visit("/reset-password?token=secret");
  passwords();
  submit("Reset password");
  await screen.findByText(
    "Your password has been reset. Sign in with your new password.",
  );
  expect(
    screen.queryByText(/missing, invalid, or expired/),
  ).not.toBeInTheDocument();
  expect(location.search).not.toContain("token");
  await act(async () => finish());
});

it("keeps successful reset confirmation when session refetch throws", async () => {
  mockApi();
  const refetch = vi.fn().mockRejectedValue(new Error("offline"));
  vi.mocked(authClient.useSession).mockReturnValue({
    data: null,
    error: null,
    isPending: false,
    isRefetching: false,
    refetch,
  });
  visit("/reset-password?token=secret");
  passwords();
  submit("Reset password");
  await screen.findByText(/password was changed, but/);
  expect(refetch).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
});
