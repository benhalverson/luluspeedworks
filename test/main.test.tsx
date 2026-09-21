import { act, screen } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-dom/client", { spy: true });

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.resetModules();
});

it("mounts the production entrypoint with the real React root and A2UI renderer", async () => {
  const container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
  await act(async () => {
    await import("../src/main");
  });
  expect(
    screen.getByRole("heading", { name: "Your bench awaits." }),
  ).toBeVisible();
  const root = vi.mocked(createRoot).mock.results[0];
  if (root?.type !== "return") throw new Error("Expected a mounted React root");
  act(() => root.value.unmount());
  expect(container).toBeEmptyDOMElement();
});

it("fails clearly when the HTML root is missing", async () => {
  await expect(import("../src/main")).rejects.toThrow(
    "Missing storefront root element",
  );
  expect(createRoot).not.toHaveBeenCalled();
});
