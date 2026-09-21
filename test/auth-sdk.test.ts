import { expect, it, vi } from "vitest";
import { authClient, authenticate } from "../src/storefront/auth";

it("uses the real Better Auth client for cookie login, session verification and POST signout", async () => {
  const requests: {
    path: string;
    method: string;
    credentials?: RequestCredentials;
  }[] = [];
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    const path = new URL(String(url)).pathname;
    requests.push({
      path,
      method: options?.method ?? "GET",
      credentials: options?.credentials,
    });
    return Response.json(
      path.endsWith("get-session")
        ? {
            user: { id: "user-1", email: "ben@example.com" },
            session: { id: "session-1" },
          }
        : { user: { id: "user-1", email: "ben@example.com" } },
    );
  });
  expect(
    await authenticate("signin", {
      email: "ben@example.com",
      password: "password123",
      name: "",
    }),
  ).toMatchObject({ id: "user-1" });
  await authClient.signOut();
  expect(requests).toEqual(
    expect.arrayContaining([
      {
        path: "/api/auth/sign-in/email",
        method: "POST",
        credentials: "include",
      },
      { path: "/api/auth/get-session", method: "GET", credentials: "include" },
      { path: "/api/auth/sign-out", method: "POST", credentials: "include" },
    ]),
  );
});

it("lets the passkey plugin request its challenge and reports provider failure without password fallback", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ message: "Unavailable" }, { status: 503 }),
  );
  await expect(
    authenticate("passkey", { email: "", password: "", name: "" }),
  ).rejects.toThrow("Passkey sign-in");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
    "/api/auth/passkey/generate-authenticate-options",
  );
});
