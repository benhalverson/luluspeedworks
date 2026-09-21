import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useProductNavigation } from "../src/storefront/navigation";

it("leaves modified, external, download, target, hash, and query links to the browser", () => {
  const { result, unmount } = renderHook(useProductNavigation);
  const link = document.createElement("a");
  link.href = "/products/1";
  document.body.append(link);
  const suppressNavigation = (event: MouseEvent) => event.preventDefault();
  window.addEventListener("click", suppressNavigation);
  for (const init of [
    { button: 1 },
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
  ] as const) {
    act(() =>
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
      ),
    );
    expect(result.current).toBe("/");
  }
  const prevented = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  prevented.preventDefault();
  act(() => link.dispatchEvent(prevented));
  for (const [attribute, value] of [
    ["target", "_blank"],
    ["download", "part"],
    ["href", "https://other.example/products/1"],
    ["href", "/#bench"],
    ["href", "/products/1?x=1"],
    ["href", "/about"],
  ] as const) {
    link.setAttribute(attribute, value);
    act(() =>
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
    expect(result.current).toBe("/");
    link.removeAttribute(attribute);
    link.href = "/products/1";
  }
  act(() =>
    document.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );
  act(() =>
    document.body.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );
  act(() =>
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );
  expect(result.current).toBe("/products/1");
  const length = window.history.length;
  act(() =>
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
  );
  expect(window.history.length).toBe(length);
  unmount();
  link.remove();
  window.removeEventListener("click", suppressNavigation);
});
