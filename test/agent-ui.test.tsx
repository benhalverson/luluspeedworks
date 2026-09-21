import {
  MessageProcessor,
  SurfaceGroupModel,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import {
  type AgentComposition,
  compositionSchema,
} from "../src/storefront/agent-contract";
import { requestGuidance } from "../src/storefront/agent-transport";
import { createCatalogController } from "../src/storefront/controller";
import { agentFixture } from "./agent-fixture";
import { renderWithClient } from "./query-client";

vi.mock("../src/storefront/agent-transport", () => ({
  requestGuidance: vi.fn(),
}));

const composition = compositionSchema.parse(agentFixture);

it("disposes an incomplete initial surface instead of rendering a broken controller", () => {
  vi.spyOn(
    MessageProcessor.prototype,
    "processMessages",
  ).mockImplementationOnce(() => {});
  const dispose = vi.spyOn(SurfaceGroupModel.prototype, "dispose");
  expect(() => createCatalogController(vi.fn())).toThrow(
    "could not be initialized",
  );
  expect(dispose).toHaveBeenCalledOnce();
});
beforeEach(() => {
  vi.mocked(requestGuidance).mockReset();
  vi.mocked(requestGuidance).mockResolvedValue(composition);
});

function send(message = "Show pit tools") {
  fireEvent.change(
    screen.getByRole("textbox", { name: "YOUR SHOPPING REQUEST" }),
    {
      target: { value: message },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Send shopping request" }),
  );
}

function deferredComposition() {
  let resolve: (value: AgentComposition) => void = () => {};
  const promise = new Promise<AgentComposition>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("validates the form, renders guidance through A2UI and restores direct browsing", async () => {
  renderWithClient(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  send("   ");
  expect(await screen.findByText("Enter a shopping request.")).toBeVisible();
  expect(requestGuidance).not.toHaveBeenCalled();
  send("  Show pit tools  ");
  expect(
    await screen.findByRole("heading", { name: "Pit tray", level: 1 }),
  ).toBeVisible();
  expect(requestGuidance).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ message: "Show pit tools" }),
    expect.any(AbortSignal),
  );
  expect(screen.getByRole("button", { name: "Add to bag" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Bag" })).toBeVisible();
  send("Show mounts");
  await waitFor(() => expect(requestGuidance).toHaveBeenCalledTimes(2));
  await screen.findByText(
    "Catalog guidance is ready. Follow a product link to choose its options.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Shop all" }));
  expect(
    await screen.findByRole("heading", { name: "Your bench awaits." }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Pit tray", level: 1 }),
  ).not.toBeInTheDocument();
});

it("cancels a pending request and ignores its late success", async () => {
  const pending = deferredComposition();
  vi.mocked(requestGuidance).mockReturnValue(pending.promise);
  renderWithClient(<App />);
  send();
  expect(await screen.findByText("Finding catalog guidance…")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Send shopping request" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel shopping request" }),
  );
  expect(vi.mocked(requestGuidance).mock.calls[0]?.[2].aborted).toBe(true);
  await act(async () => pending.resolve(composition));
  expect(
    screen.queryByRole("heading", { name: "Pit tray", level: 1 }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send shopping request" }),
    ).toBeEnabled(),
  );
});

it.each([
  [
    "Private transport diagnostics",
    "Shopping guidance is unavailable. You can keep browsing or try again.",
  ],
  [
    "Shopping guidance has reached its monthly budget. Browse with the controls below.",
    "Shopping guidance has reached its monthly budget. Browse with the controls below.",
  ],
])("preserves a valid surface on failure: %s", async (error, status) => {
  renderWithClient(<App />);
  send();
  await screen.findByRole("heading", { name: "Pit tray", level: 1 });
  vi.mocked(requestGuidance).mockRejectedValue(new Error(error));
  send("Another request");
  expect(await screen.findByText(status)).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Pit tray", level: 1 }),
  ).toBeVisible();
});

it("aborts on unmount and prevents a late result from publishing", async () => {
  const pending = deferredComposition();
  vi.mocked(requestGuidance).mockReturnValue(pending.promise);
  const view = renderWithClient(<App />);
  send();
  await screen.findByText("Finding catalog guidance…");
  view.unmount();
  expect(vi.mocked(requestGuidance).mock.calls[0]?.[2].aborted).toBe(true);
  await act(async () => pending.resolve(composition));
});

it("rejects a forged composer action and cancels guidance on product navigation", async () => {
  const dispatch = vi.spyOn(SurfaceModel.prototype, "dispatchAction");
  renderWithClient(<App />);
  send();
  await screen.findByRole("heading", { name: "Pit tray", level: 1 });
  const surface = dispatch.mock.instances[0];
  if (!(surface instanceof SurfaceModel)) throw new Error("Missing surface");
  await act(async () => {
    await surface.dispatchAction(
      { event: { name: "shopping-request", context: {} } },
      "composer",
    );
  });
  expect(requestGuidance).toHaveBeenCalledOnce();
  const pending = deferredComposition();
  vi.mocked(requestGuidance).mockReturnValue(pending.promise);
  send("A pending request");
  await screen.findByText("Finding catalog guidance…");
  fireEvent.click(screen.getByRole("link", { name: "Pit tray" }));
  await waitFor(() => expect(window.location.pathname).toBe("/products/1"));
  expect(vi.mocked(requestGuidance).mock.calls[1]?.[2].aborted).toBe(true);
  await act(async () => pending.resolve(composition));
  expect(
    screen.queryByRole("link", { name: "Pit tray" }),
  ).not.toBeInTheDocument();
});
