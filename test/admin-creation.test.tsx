import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useDraftCreation } from "../src/admin/creation";
import { draft } from "./admin-fixtures";

const key = "lulu-admin-create-v1:https://api.luluspeedworks.com:admin";
const original = {
  requestKey: "11111111-1111-4111-8111-111111111111",
  target: { kind: "new" },
};
const accept = vi.fn();
function Harness({ identity = "admin" }: { identity?: string }) {
  const creation = useDraftCreation(identity);
  const live = useRef(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const guard = () => {
    if (!live.current) throw Error("Visit ended");
  };
  const run = (work: () => Promise<unknown>) => {
    void work()
      .then((result) => setMessage(String(result)))
      .catch((error: Error) => setMessage(error.message));
  };
  return (
    <>
      <p>{JSON.stringify(creation.pending)}</p>
      <p role="status">{message}</p>
      <button
        type="button"
        onClick={() =>
          run(() => creation.begin({ kind: "new" }, accept, guard, () => {}))
        }
      >
        Begin
      </button>
      <button
        type="button"
        onClick={() =>
          run(() =>
            creation.begin(
              { kind: "existing", productId: 1 },
              accept,
              guard,
              () => {},
            ),
          )
        }
      >
        Existing
      </button>
      <button
        type="button"
        onClick={() => run(() => creation.recover(accept, guard))}
      >
        Recover
      </button>
      <button
        type="button"
        onClick={() => run(() => creation.retry(accept, guard))}
      >
        Force retry
      </button>
      <button
        type="button"
        disabled={!creation.canRetry}
        onClick={() => run(() => creation.retry(accept, guard))}
      >
        Retry
      </button>
    </>
  );
}
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const seeded = () => localStorage.setItem(key, JSON.stringify(original));
beforeEach(() => {
  localStorage.clear();
  accept.mockReset();
  vi.mocked(fetch).mockResolvedValue(Response.json(draft()));
});

it.each(["Begin", "Existing"])(
  "durably saves the initial %s request before POST and clears only after accepting its matching reply",
  async (button) => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual(body);
      expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(init).toMatchObject({
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      return Response.json(draft({ target: body.target }));
    });
    render(<Harness />);
    click(button);
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(key)).toBe("null");
  },
);

it("reloads an uncertain creation and recovers the current edited draft without another POST", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(Error("Lost acknowledgement"));
  const first = render(<Harness />);
  click("Begin");
  await screen.findByText("Lost acknowledgement");
  const stored = JSON.parse(localStorage.getItem(key) ?? "null");
  first.unmount();
  vi.mocked(fetch).mockResolvedValue(
    Response.json(
      draft({
        revision: 4,
        state: {
          answers: { name: "Later saved edits" },
          history: [],
          pendingQuestions: [],
        },
      }),
    ),
  );
  render(<Harness />);
  expect(fetch).toHaveBeenCalledTimes(1);
  click("Recover");
  await screen.findByText("found");
  expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain(
    `/by-request-key/${stored.requestKey}`,
  );
  expect(accept).toHaveBeenCalledWith(
    expect.objectContaining({
      revision: 4,
      state: expect.objectContaining({
        answers: { name: "Later saved edits" },
      }),
    }),
  );
  expect(
    vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});

it("allows only an explicit same-input replay after an authoritative 404", async () => {
  seeded();
  render(<Harness />);
  click("Force retry");
  await screen.findByText(/Check the original conversation request/);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 404 }));
  click("Recover");
  await screen.findByText("missing");
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  click("Retry");
  await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toEqual(
    original,
  );
});

it("resolves an explicitly discarded request without recreating it", async () => {
  seeded();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 410 }));
  render(<Harness />);
  click("Recover");
  await screen.findByText("discarded");
  expect(localStorage.getItem(key)).toBe("null");
  expect(accept).not.toHaveBeenCalled();
});

it.each(["{", JSON.stringify({ requestKey: "bad" })])(
  "blocks corrupt recovery storage %s",
  async (stored) => {
    localStorage.setItem(key, stored);
    render(<Harness />);
    click("Begin");
    await screen.findByText(/recovery is unreadable/);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each(["Recover", "Force retry"])(
  "rejects %s when no recovery request exists",
  async (button) => {
    render(<Harness />);
    click(button);
    await waitFor(() =>
      expect(screen.getByRole("status")).not.toBeEmptyDOMElement(),
    );
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("does not replace an outstanding creation or reveal it to another account", async () => {
  seeded();
  const view = render(<Harness />);
  click("Begin");
  await screen.findByText(/Recover the pending conversation/);
  view.unmount();
  render(<Harness identity="other" />);
  click("Recover");
  await screen.findByText(/No pending conversation/);
  expect(localStorage.getItem(key)).toBe(JSON.stringify(original));
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["locks", "storage"])(
  "does not submit without working %s",
  async (failure) => {
    if (failure === "locks") Reflect.deleteProperty(navigator, "locks");
    else {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw Error("quota");
      });
    }
    render(<Harness />);
    click("Begin");
    await waitFor(() =>
      expect(screen.getByRole("status")).not.toBeEmptyDOMElement(),
    );
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("keeps the pointer if storage fails while acknowledging a recovered draft", async () => {
  seeded();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("quota");
  });
  render(<Harness />);
  click("Recover");
  await screen.findByText(/storage is unavailable/);
  expect(localStorage.getItem(key)).toBe(JSON.stringify(original));
});

it.each(["target", "pointer", "status"])(
  "rejects a response after its %s differs",
  async (change) => {
    seeded();
    vi.mocked(fetch).mockImplementation(async () => {
      if (change === "pointer")
        localStorage.setItem(
          key,
          JSON.stringify({
            ...original,
            requestKey: "22222222-2222-4222-8222-222222222222",
          }),
        );
      return Response.json(
        draft(
          change === "target"
            ? { target: { kind: "existing", productId: 1 } }
            : change === "status"
              ? { status: "discarded" }
              : {},
        ),
      );
    });
    render(<Harness />);
    click("Recover");
    await screen.findByText(/does not match this request/);
    expect(accept).not.toHaveBeenCalled();
  },
);

it("does not acknowledge a pending write after the visit ends", async () => {
  let release!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = render(<Harness />);
  click("Begin");
  await waitFor(() => expect(release).toBeTypeOf("function"));
  const stored = localStorage.getItem(key);
  view.unmount();
  await act(async () => release(Response.json(draft())));
  expect(localStorage.getItem(key)).toBe(stored);
  expect(accept).not.toHaveBeenCalled();
});

it("does not submit a queued creation after its visit ends", async () => {
  let grant!: () => Promise<unknown>;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_key: string, callback: () => Promise<unknown>) =>
        new Promise((resolve, reject) => {
          grant = async () => {
            try {
              resolve(await callback());
            } catch (error) {
              reject(error);
            }
          };
        }),
    },
  });
  const view = render(<Harness />);
  click("Begin");
  view.unmount();
  await act(async () => grant());
  expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBeNull();
});

it.each(["visit", "pointer"])(
  "does not clear recovery on a stale 410 after the %s changes",
  async (change) => {
    seeded();
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = render(<Harness />);
    click("Recover");
    await waitFor(() => expect(release).toBeTypeOf("function"));
    if (change === "visit") view.unmount();
    else
      localStorage.setItem(
        key,
        JSON.stringify({
          ...original,
          requestKey: "22222222-2222-4222-8222-222222222222",
        }),
      );
    const stored = localStorage.getItem(key);
    await act(async () => release(Response.json({}, { status: 410 })));
    expect(localStorage.getItem(key)).toBe(stored);
    expect(accept).not.toHaveBeenCalled();
  },
);
