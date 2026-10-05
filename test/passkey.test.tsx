import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authClient } from "../src/storefront/auth";
import { AddPasskey, supportsPasskeys } from "../src/storefront/passkey";
import { setBrowserOrigin } from "./browser-origin";
import { renderWithClient } from "./query-client";

const initialBrowserOrigin = window.location.origin;

vi.mock("../src/storefront/auth", () => ({
  authClient: { passkey: { addPasskey: vi.fn() } },
}));

beforeEach(() => {
  setBrowserOrigin("https://rc-store.benhalverson.dev");
});

afterEach(() => setBrowserOrigin(initialBrowserOrigin));

it("uses Better Auth registration and disables repeat submissions during the ceremony", async () => {
  let complete = () => {};
  vi.mocked(authClient.passkey.addPasskey).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = () =>
          resolve({
            data: {
              id: "passkey-1",
              userId: "alice",
              publicKey: "test-public-key",
              credentialID: "test-credential",
              counter: 0,
              deviceType: "multiDevice",
              backedUp: true,
              createdAt: new Date(),
            },
            error: null,
          });
      }),
  );
  renderWithClient(<AddPasskey />);
  const button = screen.getByRole("button", { name: "Add a passkey" });
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeDisabled());
  expect(screen.getByRole("status")).toHaveTextContent("Follow your device");
  complete();
  await screen.findByText(/Passkey added/);
  expect(authClient.passkey.addPasskey).toHaveBeenCalledWith();
  expect(button).toBeEnabled();
});

it("shows cancellation as a recoverable failure", async () => {
  vi.mocked(authClient.passkey.addPasskey).mockResolvedValueOnce({
    data: null,
    error: { message: "Cancelled", status: 400, statusText: "Bad Request" },
  });
  renderWithClient(<AddPasskey />);
  fireEvent.click(screen.getByRole("button", { name: "Add a passkey" }));
  await screen.findByText("Passkey could not be added. Please try again.");
  expect(screen.queryByText(/Passkey added/)).toBeNull();
  expect(screen.getByRole("button", { name: "Add a passkey" })).toBeEnabled();
});

it.each([
  "https://luluspeedworks.com",
  "https://www.luluspeedworks.com",
  "http://localhost:3000",
  "https://rc-store.benhalverson.dev.evil.example",
  "http://rc-store.benhalverson.dev",
])("hides registration outside the configured passkey origin: %s", (origin) => {
  setBrowserOrigin(origin);
  expect(supportsPasskeys()).toBe(false);
  renderWithClient(<AddPasskey />);
  expect(screen.queryByRole("button", { name: "Add a passkey" })).toBeNull();
});
