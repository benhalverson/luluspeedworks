import { SurfaceModel } from "@a2ui/web_core/v0_9";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { App } from "../src/App";
import {
  parseProductId,
  productFailure,
  quantityValid,
} from "../src/storefront/product";
import { apiPage, categories, product } from "./catalog-fixtures";
import { renderWithClient as render } from "./query-client";

const red = {
  publicId: "76fe1f79-3f1e-43e4-b8f4-61159de5b93c",
  name: "PLA red",
  color: "red",
  profile: "PLA",
  available: true,
};
const otherRed = { ...red, publicId: "8cfbf30a-2995-486e-a1e8-8f7d41488f1e" };
const detail = (id = 1) => ({
  ...product(id),
  skuNumber: `SKU-${id + 100}`,
  filamentType: "PLA",
  categories,
  imageGallery: ["https://images.example.com/gallery.png"],
  compatibility: "Fits the supplied test chassis only.",
});
function respond(
  options: {
    detail?: () => Promise<Response>;
    colors?: () => Promise<Response>;
    catalogPending?: boolean;
  } = {},
) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/categories")
      return options.catalogPending
        ? new Promise(() => {})
        : Response.json(categories);
    if (url.pathname === "/products")
      return options.catalogPending
        ? new Promise(() => {})
        : Response.json(apiPage([1, 2]));
    if (url.pathname === "/v2/colors")
      return options.colors
        ? options.colors()
        : Response.json({ success: true, data: [red, otherRed] });
    return options.detail
      ? options.detail()
      : Response.json(detail(Number(url.pathname.split("/").at(-1))));
  });
}
function enter(path: string) {
  act(() => {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}
async function ready() {
  await screen.findAllByRole("option", { name: "red — PLA red" });
}

it("loads a direct URL independently, renders authoritative safe detail and UUID options through A2UI actions", async () => {
  window.history.replaceState(null, "", "/products/1");
  const hostile = "<script>alert('x')</script>";
  respond({
    catalogPending: true,
    detail: async () => Response.json({ ...detail(), description: hostile }),
  });
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Loading product",
  );
  await ready();
  expect(screen.getByText("Loading catalog…")).toBeVisible();
  expect(screen.getByText("$2.29")).toBeVisible();
  expect(screen.getByText(hostile)).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByText("SKU: SKU-101")).toBeVisible();
  expect(screen.getByText("Material: PLA")).toBeVisible();
  expect(
    screen.getByText("Fits the supplied test chassis only."),
  ).toBeVisible();
  const color = screen.getByLabelText("Color");
  const options = screen.getAllByRole("option", { name: "red — PLA red" });
  expect(options).toHaveLength(2);
  expect(options.map((option) => option.getAttribute("value"))).toEqual([
    red.publicId,
    otherRed.publicId,
  ]);
  expect(color).not.toHaveTextContent(red.publicId);
  expect(color).not.toHaveTextContent(otherRed.publicId);
  expect(color).toHaveValue("");
  expect(screen.getByLabelText("Quantity")).toHaveValue(1);
  fireEvent.change(color, { target: { value: red.publicId } });
  await waitFor(() => expect(color).toHaveValue(red.publicId));
  fireEvent.change(color, { target: { value: otherRed.publicId } });
  await waitFor(() => expect(color).toHaveValue(otherRed.publicId));
  fireEvent.change(color, { target: { value: "" } });
  await waitFor(() => expect(color).toHaveValue(""));
  for (const value of ["0", "70", "1.5", "", "-1"]) {
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value } });
    await screen.findByText("Enter a whole number from 1 to 69.");
  }
  for (const value of ["69", "1"]) {
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value } });
    await waitFor(() =>
      expect(
        screen.queryByText("Enter a whole number from 1 to 69."),
      ).toBeNull(),
    );
  }
  for (const image of screen
    .getAllByRole("img", { name: "Part 1" })
    .slice(0, 1))
    fireEvent.error(image);
  expect(screen.getByText("Image unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: /Add to bag/ })).toBeDisabled();
  expect(fetch).toHaveBeenCalledWith(
    new URL(
      "https://api.benhalverson.dev/v2/colors?profile=PLA&available=true",
    ),
    expect.anything(),
  );
});

it("uses native links, remembers each product, revalidates entry, and resets on reload", async () => {
  let options = [red, otherRed];
  respond({
    colors: async () => Response.json({ success: true, data: options }),
  });
  const view = render(<App />);
  const link = await screen.findByRole("link", { name: "Part 1" });
  expect(link).toHaveAttribute("href", "/products/1");
  fireEvent.click(link);
  await ready();
  expect(window.location.pathname).toBe("/products/1");
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Color"), {
    target: { value: red.publicId },
  });
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("link", { name: "Part 2" }));
  await ready();
  expect(screen.getByLabelText("Color")).toHaveValue("");
  expect(screen.getByLabelText("Quantity")).toHaveValue(1);
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await ready();
  expect(screen.getByLabelText("Color")).toHaveValue(red.publicId);
  expect(screen.getByLabelText("Quantity")).toHaveValue(3);
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await ready();
  options = [otherRed];
  enter("/products/1");
  await screen.findByText(
    "Your selected color is unavailable. Choose another color.",
  );
  expect(screen.getByLabelText("Color")).toHaveValue("");
  expect(screen.getByLabelText("Quantity")).toHaveValue(3);
  enter("/products/2");
  await screen.findByRole("heading", { level: 1, name: "Part 2" });
  options = [red, otherRed];
  enter("/products/1");
  await ready();
  expect(screen.getByLabelText("Color")).toHaveValue("");
  expect(
    screen.getByText(
      "Your selected color is unavailable. Choose another color.",
    ),
  ).toBeVisible();
  view.unmount();
  render(<App />);
  await ready();
  expect(screen.getByLabelText("Quantity")).toHaveValue(1);
  expect(
    screen.queryByText(
      "Your selected color is unavailable. Choose another color.",
    ),
  ).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Back to Shop all" }));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Your bench awaits.",
  );
});

it("keeps product configuration through React Router home links and restores route focus", async () => {
  window.history.replaceState(null, "", "/products/1?shared=true#details");
  respond();
  render(<App />);
  await ready();
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "7" },
  });
  fireEvent.change(screen.getByLabelText("Color"), {
    target: { value: otherRed.publicId },
  });
  fireEvent.click(screen.getByRole("link", { name: "Lulu Speedworks home" }));
  expect(window.location.pathname).toBe("/");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Your bench awaits.",
  );
  fireEvent.click(await screen.findByRole("link", { name: "Part 1" }));
  await ready();
  expect(screen.getByLabelText("Quantity")).toHaveValue(7);
  expect(screen.getByLabelText("Color")).toHaveValue(otherRed.publicId);
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
});

it.each([
  "/products/SKU-101",
  "/products/0",
  "/products/-1",
  "/products/1.5",
  "/products/1junk",
  "/products/1/extra",
  "/products/9007199254740992",
  "/unknown",
])(
  "rejects malformed route %s without requesting that detail",
  async (path) => {
    window.history.replaceState(null, "", path);
    respond({ catalogPending: true });
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Product not found.",
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([url]) => !String(url).includes("/product/")),
    ).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Back to Shop all" }));
    expect(window.location.pathname).toBe("/");
  },
);

it.each(["404", "network", "json", "schema", "wrong-id"])(
  "recovers from %s detail failures",
  async (kind) => {
    window.history.replaceState(null, "", "/products/1");
    respond({
      catalogPending: true,
      detail: async () => {
        if (kind === "404") return new Response(null, { status: 404 });
        if (kind === "network") throw new TypeError("offline");
        if (kind === "json") return new Response("bad json");
        return Response.json(kind === "schema" ? {} : detail(2));
      },
    });
    render(<App />);
    const retry = await screen.findByRole("button", { name: "Retry product" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      kind === "404"
        ? "Product not found"
        : kind === "network"
          ? "Check your connection"
          : "Malformed product response",
    );
    respond({ catalogPending: true });
    fireEvent.click(retry);
    await ready();
  },
);

it.each([
  "wrong-material",
  "unavailable",
  "duplicate-id",
  "invalid-id",
  "json",
  "network",
  "empty",
])("handles %s color results and retry", async (kind) => {
  window.history.replaceState(null, "", "/products/1");
  respond({
    catalogPending: true,
    colors: async () => {
      if (kind === "network") throw new TypeError("offline");
      if (kind === "json") return new Response("bad");
      const data =
        kind === "empty"
          ? []
          : kind === "duplicate-id"
            ? [red, red]
            : [
                {
                  ...red,
                  ...(kind === "wrong-material"
                    ? { profile: "PETG" }
                    : kind === "unavailable"
                      ? { available: false }
                      : { publicId: "bad" }),
                },
              ];
      return Response.json({ success: true, data });
    },
  });
  render(<App />);
  if (kind === "empty") {
    await screen.findByText(
      "No colors are currently available for this material.",
    );
    expect(screen.getAllByRole("option")).toHaveLength(1);
  } else {
    const retry = await screen.findByRole("button", { name: "Retry colors" });
    expect(screen.getByLabelText("Color")).toBeDisabled();
    respond({ catalogPending: true });
    fireEvent.click(retry);
    await ready();
  }
});

it("cancels obsolete detail and ignores a late response even when fetch ignores cancellation", async () => {
  window.history.replaceState(null, "", "/products/1");
  let finish: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  respond({ catalogPending: true, detail: () => pending });
  const view = render(<App />);
  const signal = vi
    .mocked(fetch)
    .mock.calls.find(([url]) =>
      String(url).endsWith("/product/1"),
    )?.[1]?.signal;
  respond({ catalogPending: true });
  enter("/products/2");
  await ready();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(Response.json(detail(1))));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Part 2");
  view.unmount();
});

it("times out detail requests and offers retry", async () => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/products/1");
  vi.mocked(fetch).mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      ),
  );
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_001);
  });
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Product request timed out",
  );
  view.unmount();
  vi.useRealTimers();
});

it("cancels obsolete color requests and cannot apply their late UUIDs to another material", async () => {
  window.history.replaceState(null, "", "/products/1");
  let finish: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  respond({ catalogPending: true, colors: () => pending });
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByText("Loading available colors…");
  const signal = vi
    .mocked(fetch)
    .mock.calls.find(([url]) =>
      String(url).includes("/v2/colors"),
    )?.[1]?.signal;
  const petg = { ...otherRed, profile: "PETG" };
  respond({
    catalogPending: true,
    detail: async () => Response.json({ ...detail(2), filamentType: "PETG" }),
    colors: async () => Response.json({ success: true, data: [petg] }),
  });
  enter("/products/2");
  const option = await screen.findByRole("option", { name: "red — PLA red" });
  expect(option).toHaveValue(otherRed.publicId);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(Response.json({ success: true, data: [red] })));
  expect(
    screen.getAllByRole("option").map((item) => item.getAttribute("value")),
  ).not.toContain(red.publicId);
  expect(screen.getByText("Material: PETG")).toBeVisible();
  expect(screen.getByLabelText("Color")).toHaveValue("");
});

it("rejects forged and stale A2UI configuration payloads", async () => {
  window.history.replaceState(null, "", "/products/1");
  const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
  respond({ catalogPending: true });
  render(<App />);
  await ready();
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "2" },
  });
  const surface = dispatch.mock.instances[0];
  if (!(surface instanceof SurfaceModel))
    throw new Error("Expected an A2UI surface");
  for (const context of [
    {},
    { productId: 2, quantity: "5" },
    { productId: 1, color: "missing" },
  ]) {
    await act(async () => {
      await surface.dispatchAction(
        { event: { name: "configure", context } },
        "configuration",
      );
    });
  }
  expect(screen.getByLabelText("Quantity")).toHaveValue(2);
  expect(screen.getByLabelText("Color")).toHaveValue("");
});

it("handles absent images and compatibility without invented claims", async () => {
  window.history.replaceState(null, "", "/products/1/");
  respond({
    catalogPending: true,
    detail: async () =>
      Response.json({
        ...detail(),
        image: null,
        imageGallery: [],
        compatibility: undefined,
      }),
  });
  render(<App />);
  await ready();
  expect(screen.getByText("Image unavailable")).toBeVisible();
  expect(screen.queryByText(/Fits the supplied/)).toBeNull();
});

it("validates route and quantity boundaries and error fallback", () => {
  expect(parseProductId(undefined)).toBe("invalid");
  expect(parseProductId("42")).toBe(42);
  expect(quantityValid("abc")).toBe(false);
  expect(productFailure(null, "Product")).toContain("unavailable");
});
