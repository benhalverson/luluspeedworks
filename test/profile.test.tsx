import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProfilePanel } from "../src/storefront/profile";
import { renderWithClient } from "./query-client";

const profile = {
  id: "alice",
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Driver",
  address: "123 Example Avenue",
  city: "Portland",
  state: "OR",
  zipCode: "97201",
  country: "US",
  phone: "5035550100",
};
beforeEach(() => {
  vi.mocked(fetch).mockResolvedValue(Response.json(profile));
});

it("loads cookie-authenticated profile data and saves to the account-bound endpoint", async () => {
  const requests: { path: string; body: Record<string, string> }[] = [];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    expect(init?.credentials).toBe("include");
    expect(init?.cache).toBe("no-store");
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ path, body });
    return Response.json(
      init?.method === "POST"
        ? { id: profile.id, email: profile.email, ...body }
        : profile,
    );
  });
  renderWithClient(<ProfilePanel userId="alice" />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading your profile");
  expect(await screen.findByLabelText("Street address")).toHaveValue(
    profile.address,
  );
  fireEvent.change(screen.getByLabelText("City"), {
    target: { value: "Salem" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByText("Profile saved.");
  expect(requests[1]).toEqual({
    path: "/profile/alice",
    body: {
      firstName: "Alice",
      lastName: "Driver",
      shippingAddress: profile.address,
      city: "Salem",
      state: "OR",
      zipCode: "97201",
      country: "US",
      phone: "5035550100",
    },
  });
});

it("validates required shipping fields before sending an update", async () => {
  renderWithClient(<ProfilePanel userId="alice" />);
  await screen.findByLabelText("First name");
  for (const label of [
    "First name",
    "Last name",
    "Street address",
    "City",
    "State code",
    "ZIP code",
    "Country code",
    "Phone",
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByText("Enter your full street address.");
  expect(screen.getByLabelText("First name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([401, 503])(
  "permits an explicit profile retry after HTTP %s",
  async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ message: "Unavailable" }, { status }),
    );
    renderWithClient(<ProfilePanel userId="alice" />);
    await screen.findByText("Profile unavailable. Retry or sign in again.");
    fireEvent.click(screen.getByRole("button", { name: "Retry profile" }));
    await screen.findByLabelText("First name");
  },
);

it("hides old form values immediately on account switch and rejects another user's response", async () => {
  const view = renderWithClient(<ProfilePanel userId="alice" />);
  await screen.findByDisplayValue("Alice");
  view.rerender(<ProfilePanel userId="bob" />);
  expect(screen.queryByDisplayValue("Alice")).toBeNull();
  await screen.findByText("Profile unavailable. Retry or sign in again.");
  expect(screen.queryByLabelText("First name")).toBeNull();
});

it("reports a rejected update without discarding the user's edits", async () => {
  renderWithClient(<ProfilePanel userId="alice" />);
  await screen.findByLabelText("City");
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ message: "Account changed" }, { status: 403 }),
  );
  fireEvent.change(screen.getByLabelText("City"), {
    target: { value: "Salem" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await screen.findByText(
    "Profile could not be saved. Check your details and try again.",
  );
  expect(screen.getByLabelText("City")).toHaveValue("Salem");
});

it("does not display an empty or malformed profile response", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
  renderWithClient(<ProfilePanel userId="alice" />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Profile unavailable"),
  );
});
