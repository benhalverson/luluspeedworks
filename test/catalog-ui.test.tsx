import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { act, fireEvent, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { App } from "../src/App";
import { apiPage, categories, mockCatalog, product } from "./catalog-fixtures";
import { renderWithClient as render } from "./query-client";

it.each([
  { membership: [] },
  { membership: [...categories, { categoryId: 3, categoryName: "RC Parts" }] },
])(
  "Shop all renders every product with missing or ambiguous named mappings",
  async ({ membership }) => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/categories") return Response.json(membership);
      if (path === "/products") return Response.json(apiPage([1]));
      return Response.json({ id: 1, categories: [] });
    });
    render(<App />);
    await screen.findByRole("link", { name: "Part 1" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Shop all: 1 products.",
    );
  },
);

it("renders entries through the official bindings, pages and resets category pagination", async () => {
  mockCatalog(21);
  const process = vi.spyOn(MessageProcessor.prototype, "processMessages");
  render(<App />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  await screen.findByText("Part 1");
  expect(screen.getAllByRole("listitem")).toHaveLength(10);
  expect(screen.getAllByText("$2.29")).toHaveLength(10);
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  const next = screen.getByRole("button", { name: "Next" });
  next.focus();
  expect(next).toHaveFocus();
  fireEvent.click(next);
  await screen.findByText("Part 11");
  fireEvent.click(next);
  await screen.findByText("Part 21");
  expect(next).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("Part 11");
  fireEvent.click(screen.getByRole("button", { name: "RC Parts" }));
  await screen.findByText("Part 1");
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "RC Parts" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Pit Tools" }));
  fireEvent.click(screen.getByRole("button", { name: "Shop all" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Shop all: 21 products. Page 1 of 3.",
  );
  expect(
    process.mock.calls.filter(
      ([messages]) =>
        Array.isArray(messages) &&
        messages.some((message) => "createSurface" in message),
    ),
  ).toHaveLength(1);
  expect(screen.getByText("The bench is clear.")).toBeVisible();
  expect(screen.getByRole("button", { name: /Add to bag/ })).toBeDisabled();
});

it("shows missing and broken image fallbacks", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json(categories))
    .mockResolvedValueOnce(
      Response.json({
        ...apiPage([1, 2]),
        products: [product(), { ...product(2), image: null }],
      }),
    )
    .mockResolvedValueOnce(Response.json({ id: 1, categories }))
    .mockResolvedValueOnce(Response.json({ id: 2, categories }));
  render(<App />);
  const image = await screen.findByRole("img", { name: "Part 1" });
  expect(screen.getAllByText("Image unavailable")).toHaveLength(1);
  fireEvent.error(image);
  expect(screen.getAllByText("Image unavailable")).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: "Part 1" }),
  ).not.toBeInTheDocument();
});

it("distinguishes unavailable mappings from an empty category and permits retry", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json([categories[1]]))
    .mockResolvedValueOnce(Response.json(apiPage([1])))
    .mockResolvedValueOnce(Response.json({ id: 1, categories: [] }));
  render(<App />);
  await screen.findByText("Part 1");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Shop all: 1 products. Page 1 of 1.",
  );
  expect(screen.getByText("$2.29")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Pit Tools" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "No products in Pit Tools.",
  );
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "RC Parts" }));
  expect(screen.getByRole("status")).toHaveTextContent("RC Parts unavailable");
  mockCatalog(0);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("No products in RC Parts.");
});

it.each(["malformed", "unavailable", "network"])(
  "announces %s failures and retries",
  async (kind) => {
    if (kind === "malformed")
      vi.mocked(fetch).mockImplementation(async () =>
        Response.json({ bad: true }),
      );
    if (kind === "unavailable")
      vi.mocked(fetch).mockImplementation(
        async () => new Response(null, { status: 503 }),
      );
    vi.stubEnv("VITE_API_ORIGIN", "https://configured.example.com");
    render(<App />);
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("status")).toHaveTextContent(
      kind === "malformed"
        ? "Malformed catalog response"
        : "Catalog unavailable",
    );
    const fetcher = mockCatalog(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Part 1");
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://configured.example.com/categories"),
      expect.anything(),
    );
  },
);

it("announces timeout with manual retry", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      ),
  );
  const view = render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Catalog request timed out",
  );
  view.unmount();

  vi.useRealTimers();
});

it("preserves a selection during loading and aborts Strict Mode/unmount work", async () => {
  const signals: AbortSignal[] = [];
  vi.mocked(fetch).mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        if (!init?.signal) throw new Error("Signal required");
        signals.push(init.signal);
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Pit Tools" }));
  expect(screen.getByRole("button", { name: "Pit Tools" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  await act(async () => view.unmount());
  expect(signals).toHaveLength(4);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});
