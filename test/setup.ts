import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { cleanStores } from "nanostores";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("No network in tests")),
  );
});

afterEach(async () => {
  cleanup();
  const { authClient } = await import("../src/storefront/auth");
  cleanStores(...Object.values(authClient.$store?.atoms ?? {}));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
