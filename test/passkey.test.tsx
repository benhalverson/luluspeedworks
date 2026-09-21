import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { authClient } from "../src/storefront/auth";
import { AddPasskey } from "../src/storefront/passkey";
import { renderWithClient } from "./query-client";

vi.mock("../src/storefront/auth", () => ({
  authClient: { passkey: { addPasskey: vi.fn() } },
}));

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
