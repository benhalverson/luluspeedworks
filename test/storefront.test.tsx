import { A2uiSurface } from "@a2ui/react/v0_9";
import {
  MessageProcessor,
  NodeResolver,
  SurfaceGroupModel,
} from "@a2ui/web_core/v0_9";
import { act, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { componentCatalog } from "../src/storefront/catalog";
import {
  initialMessages,
  surfaceId,
  wireVersion,
} from "../src/storefront/messages";
import { renderWithClient as render } from "./query-client";

describe("Pit Bench", () => {
  it("renders the actual A2UI surface with empty regions and unavailable commerce", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Your bench awaits." }),
    ).toBeVisible();
    expect(
      screen.getByRole("complementary", { name: "THE PARTS DRAWER" }),
    ).toBeVisible();
    expect(screen.getByText("Loading catalog…")).toBeVisible();
    expect(screen.getByRole("region", { name: "MAKE IT YOURS" })).toBeVisible();
    expect(screen.getByText("No part selected")).toBeVisible();
    expect(
      screen.getByRole("region", { name: "YOUR SHOPPING REQUEST" }),
    ).toBeVisible();
    expect(
      screen.getByAltText("Lulu the dog with a racing badge"),
    ).toHaveAttribute("src", "/brand/lulu-logo.svg");
    for (const name of [
      "Add to bag",
      "Send shopping request",
      "Previous",
      "Next",
    ])
      expect(
        screen.getByRole("button", { name: new RegExp(name) }),
      ).toBeDisabled();
    for (const label of ["Color", "Quantity", "YOUR SHOPPING REQUEST"])
      expect(
        screen.getByLabelText(label, { selector: "input" }),
      ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Skip to the bench" }),
    ).toHaveAttribute("href", "#bench");
    expect(screen.getByRole("main")).toHaveAttribute("id", "bench");
  });

  it("resolves data bindings and updates them through official messages", () => {
    const processor = new MessageProcessor([componentCatalog], undefined, {
      version: wireVersion,
    });
    processor.processMessages(structuredClone(initialMessages));
    const surface = processor.model.getSurface(surfaceId);
    if (!surface) throw new Error("Initial messages must create the surface");
    const view = render(<A2uiSurface surface={surface} />);
    act(() =>
      processor.processMessages([
        {
          version: wireVersion,
          updateDataModel: {
            surfaceId,
            path: "/",
            value: {
              title: "A new bench title",
              description: "Updated through the data model",
            },
          },
        },
      ]),
    );
    expect(
      screen.getByRole("heading", { name: "A new bench title" }),
    ).toBeVisible();
    expect(screen.getByText("Updated through the data model")).toBeVisible();
    expect(screen.queryByText("Your bench awaits.")).not.toBeInTheDocument();
    view.unmount();
    processor.model.dispose();
    expect(processor.model.surfacesMap.size).toBe(0);
  });

  it("owns fresh processors and disposes models and renderer subscriptions across Strict Mode replay and remount", () => {
    const dispose = vi.spyOn(SurfaceGroupModel.prototype, "dispose");
    const resolverDispose = vi.spyOn(NodeResolver.prototype, "dispose");
    const consoleError = vi.spyOn(console, "error");
    const consoleWarn = vi.spyOn(console, "warn");
    const view = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(resolverDispose).toHaveBeenCalled();
    for (const model of dispose.mock.instances) {
      if (!(model instanceof SurfaceGroupModel))
        throw new Error("Expected a surface group");
      expect(model.surfacesMap.size).toBe(0);
    }
    const again = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByText("The bench is clear.")).toBeVisible();
    again.unmount();
    expect(dispose).toHaveBeenCalledTimes(4);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
