import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { useCartSessionRecovery } from "../src/storefront/cart-session";

/** Exercises subscription replay and cleanup with the same StrictMode used by the app. */
function Wrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

it("refreshes only the matching origin with the latest callback and disposes listeners", async () => {
  const first = vi.fn();
  const second = vi.fn();
  const view = renderHook(
    ({ refetch }) => useCartSessionRecovery("https://api.example", refetch),
    { initialProps: { refetch: first }, wrapper: Wrapper },
  );
  act(() => window.dispatchEvent(new Event("lulu-cart-expired:other")));
  expect(first).not.toHaveBeenCalled();
  act(() =>
    window.dispatchEvent(new Event("lulu-cart-expired:https://api.example")),
  );
  expect(first).toHaveBeenCalledTimes(1);
  view.rerender({ refetch: second });
  act(() =>
    window.dispatchEvent(new Event("lulu-cart-expired:https://api.example")),
  );
  expect(second).toHaveBeenCalledTimes(1);
  view.unmount();
  act(() =>
    window.dispatchEvent(new Event("lulu-cart-expired:https://api.example")),
  );
  expect(second).toHaveBeenCalledTimes(1);
});

it("leaves failed session refresh recovery to the session hook without an unhandled rejection", async () => {
  const refetch = vi.fn().mockRejectedValue(new Error("Offline"));
  renderHook(() => useCartSessionRecovery("api", refetch));
  await act(async () =>
    window.dispatchEvent(new Event("lulu-cart-expired:api")),
  );
  await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
});
