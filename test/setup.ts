import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { cleanStores } from "nanostores";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  // jsdom lacks Web Locks; serialize callbacks like the browser primitive.
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (name: string, work: () => Promise<unknown>) => {
        const next = (queues.get(name) ?? Promise.resolve())
          .catch(() => {})
          .then(work);
        queues.set(name, next);
        return next;
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("No network in tests")),
  );
});

afterEach(async () => {
  cleanup();
  Reflect.deleteProperty(navigator, "locks");
  const { authClient } = await import("../src/storefront/auth");
  cleanStores(...Object.values(authClient.$store?.atoms ?? {}));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
