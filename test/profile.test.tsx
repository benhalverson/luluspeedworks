import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProfilePanel } from "../src/storefront/profile";
import { renderWithClient, testClient } from "./query-client";

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

for (const dirtyAddress of [false, true]) {
  it(`reconciles a refreshed profile while preserving intentional edits (${dirtyAddress})`, async () => {
    let saved = profile;
    const writes: Record<string, string>[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        return Response.json({ id: profile.id, email: profile.email, ...body });
      }
      return Response.json(saved);
    });
    const client = testClient();
    renderWithClient(<ProfilePanel userId="alice" />, client);
    await screen.findByDisplayValue(profile.address);
    if (dirtyAddress)
      fireEvent.change(screen.getByLabelText("Street address"), {
        target: { value: "300 My Edited Street" },
      });
    saved = { ...profile, address: "200 New Street" };
    await act(async () => {
      await client.refetchQueries({ queryKey: ["profile"] });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Street address")).toHaveValue(
        dirtyAddress ? "300 My Edited Street" : saved.address,
      ),
    );
    if (dirtyAddress)
      expect(
        screen.getByText(/Saved street address: 200 New Street/),
      ).toHaveTextContent("Your edit is kept when you save.");
    fireEvent.change(screen.getByLabelText("Phone"), {
      target: { value: "5035550101" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Profile saved.");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      shippingAddress: dirtyAddress ? "300 My Edited Street" : saved.address,
      phone: "5035550101",
    });
    expect(
      client.getQueryData([
        "profile",
        "https://api.luluspeedworks.com",
        "alice",
      ]),
    ).toMatchObject(writes[0] ?? {});
    expect(screen.queryByText(/Your edit is kept/)).toBeNull();
  });
}

it("does not publish a save after leaving while query cancellation is pending", async () => {
  const client = testClient();
  let finish!: () => void;
  vi.spyOn(client, "cancelQueries").mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const onSaved = vi.fn();
  vi.mocked(fetch).mockImplementation(async (_url, init) =>
    Response.json(
      init?.method === "POST"
        ? { ...profile, shippingAddress: "300 Saved Street" }
        : profile,
    ),
  );
  const view = renderWithClient(
    <ProfilePanel userId="alice" onSaved={onSaved} />,
    client,
  );
  await screen.findByLabelText("City");
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(client.cancelQueries).toHaveBeenCalled());
  view.unmount();
  await act(async () => finish());
  expect(onSaved).not.toHaveBeenCalled();
  expect(
    client.getQueryData(["profile", "https://api.luluspeedworks.com", "alice"]),
  ).not.toMatchObject({ shippingAddress: "300 Saved Street" });
});

it("a save cancels an older profile read so it cannot roll back the acknowledged snapshot", async () => {
  const client = testClient();
  let finish!: (response: Response) => void;
  let finishSave!: (response: Response) => void;
  let reads = 0;
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === "POST")
      return new Promise<Response>((resolve) => {
        finishSave = resolve;
      });
    if (++reads > 1)
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    return Response.json(profile);
  });
  renderWithClient(<ProfilePanel userId="alice" />, client);
  await screen.findByLabelText("City");
  fireEvent.change(screen.getByLabelText("City"), {
    target: { value: "Salem" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(finishSave).toBeTypeOf("function"));
  act(() => {
    void client.refetchQueries({ queryKey: ["profile"] });
  });
  await waitFor(() => expect(reads).toBe(2));
  await act(async () =>
    finishSave(
      Response.json({
        ...profile,
        shippingAddress: profile.address,
        city: "Salem",
      }),
    ),
  );
  await screen.findByText("Profile saved.");
  await act(async () => finish(Response.json(profile)));
  expect(screen.getByLabelText("City")).toHaveValue("Salem");
  expect(
    client.getQueryData(["profile", "https://api.luluspeedworks.com", "alice"]),
  ).toMatchObject({ city: "Salem" });
});
