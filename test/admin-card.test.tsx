import { A2uiSurface } from "@a2ui/react/v0_9";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { adminCatalog, type CardView, DraftCard } from "../src/admin/card";
import { draftId, photoId } from "./admin-fixtures";
import { renderWithClient } from "./query-client";

it("resolves static A2UI child references and sends bound structured actions", () => {
  const action = vi.fn();
  const processor = new MessageProcessor([adminCatalog], action, {
    version: "v0.9.1",
  });
  processor.processMessages([
    {
      version: "v0.9.1",
      createSurface: { surfaceId: "static", catalogId: adminCatalog.id },
    },
    {
      version: "v0.9.1",
      updateComponents: {
        surfaceId: "static",
        components: [
          {
            id: "root",
            component: "ProductCard",
            draftId,
            title: "Static bindings",
            confirmations: [{ name: "Parts", confirmed: true }],
            summary: "Pricing awaits preparation",
            actionLabel: "Create product — unavailable",
            fields: { componentId: "field", path: "/fields" },
            attachments: ["photo"],
            questions: "",
            status: "",
            busy: false,
          },
          {
            id: "field",
            component: "DraftField",
            draftId,
            field: "name",
            options: [],
            label: "Bound name",
            value: "Saved value",
            disabled: false,
          },
          {
            id: "photo",
            component: "DraftAttachment",
            draftId,
            attachmentId: photoId,
            name: "Photo",
            image: "",
            status: "Saved",
            photo: true,
            primary: false,
            first: false,
            last: false,
            busy: false,
            reselect: false,
            resolve: false,
          },
        ],
      },
    },
  ]);
  processor.processMessages([
    {
      version: "v0.9.1",
      updateDataModel: {
        surfaceId: "static",
        path: "/",
        value: { fields: [{}] },
      },
    },
  ]);
  const surface = processor.model.getSurface("static");
  if (!surface) throw Error("Expected surface");
  const view = renderWithClient(<A2uiSurface surface={surface} />);
  expect(screen.getByLabelText("Bound name")).toHaveValue("Saved value");
  fireEvent.change(screen.getByLabelText("Bound name"), {
    target: { value: "Changed" },
  });
  expect(action).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "answer",
      context: { draftId, field: "name", value: "Changed" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Make primary" }));
  expect(action).toHaveBeenLastCalledWith(
    expect.objectContaining({
      name: "primary",
      context: { draftId, id: photoId },
    }),
  );
  view.unmount();
  processor.model.dispose();
});

function mutationCard(
  action: "create" | "update" | "delete",
  ready = false,
): CardView {
  return {
    draftId,
    title: "Prepared part",
    summary: "Saved answers",
    actionLabel: "Unavailable",
    confirmations: [],
    questions: "",
    status: "Draft saved",
    busy: false,
    fields: [],
    attachments: [],
    mutation: {
      action,
      ready,
      review: "Online price: $12.50 USD",
      status: ready ? "Ready to submit" : "Validation: a photo is required",
    },
  };
}

it.each(["create", "update", "delete"] as const)(
  "requires prepared readiness before an explicit %s action",
  async (kind) => {
    const action = vi.fn();
    const card = mutationCard(kind);
    const view = renderWithClient(<DraftCard view={card} onAction={action} />);
    const label = {
      create: "Create product",
      update: "Save changes",
      delete: "Delete product",
    }[kind];
    expect(await screen.findByRole("button", { name: label })).toBeDisabled();
    expect(screen.getByText("Online price: $12.50 USD")).toBeVisible();
    expect(screen.getByText("Validation: a photo is required")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name:
          kind === "delete"
            ? "Review product deletion"
            : "Review product changes",
      }),
    );
    expect(action).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "review",
        context: { draftId, action: kind },
      }),
    );
    if (kind === "update") {
      fireEvent.click(
        screen.getByRole("button", { name: "Review product deletion" }),
      );
      expect(action).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: "review",
          context: { draftId, action: "delete" },
        }),
      );
    }
    if (kind === "delete") {
      fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
      expect(action).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: "cancelDelete",
          context: { draftId, action: "update" },
        }),
      );
    }
    if (kind === "create")
      expect(
        screen.queryByRole("button", { name: "Review product deletion" }),
      ).not.toBeInTheDocument();
    view.rerender(
      <DraftCard view={mutationCard(kind, true)} onAction={action} />,
    );
    expect(screen.getByRole("button", { name: label })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(action).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "submit",
        context: { draftId, action: kind },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save draft answers" }));
    expect(action).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "save", context: { draftId } }),
    );
    view.rerender(
      <DraftCard
        view={{ ...mutationCard(kind, true), busy: true }}
        onAction={action}
      />,
    );
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name:
          kind === "delete"
            ? "Review product deletion"
            : "Review product changes",
      }),
    ).toBeDisabled();
  },
);

it("checks an unresolved operation only on explicit action and prevents repeated submission", async () => {
  const action = vi.fn();
  const card = mutationCard("create", true);
  const view = renderWithClient(
    <DraftCard
      view={{
        ...card,
        mutation: {
          action: "create",
          ready: true,
          review: "Submitted product",
          status: "Outcome unknown",
          operationId: "operation-1",
        },
      }}
      onAction={action}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Create product" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Review product changes" }),
  ).toBeDisabled();
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Check product operation" }),
  );
  expect(action).toHaveBeenLastCalledWith(
    expect.objectContaining({
      name: "reconcile",
      context: { draftId, operationId: "operation-1" },
    }),
  );
  view.rerender(
    <DraftCard
      view={{
        ...card,
        busy: true,
        mutation: {
          action: "create",
          ready: true,
          review: "Submitted product",
          status: "Checking",
          operationId: "operation-1",
        },
      }}
      onAction={action}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Check product operation" }),
  ).toBeDisabled();
});

it("keeps legacy cards preparation-only when catalog mutation evidence is absent", async () => {
  const action = vi.fn();
  const view: CardView = {
    draftId,
    title: "Saved preparation",
    summary: "Draft facts",
    actionLabel: "Create product — unavailable",
    confirmations: [],
    questions: "",
    status: "Saved",
    busy: false,
    fields: [],
    attachments: [],
  };
  renderWithClient(<DraftCard view={view} onAction={action} />);
  expect(
    await screen.findByRole("button", { name: "Create product — unavailable" }),
  ).toBeDisabled();
  expect(
    screen.getByText(
      "Preparation only. Saving answers never creates, publishes, updates or deletes a product.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Review product changes" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save draft answers" }));
  expect(action).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "save", context: { draftId } }),
  );
});

it.each(["https://api.lulu.test/photo.png", ""])(
  "shows the exact deletion identity with image %s",
  async (image) => {
    const view = mutationCard("delete", true);
    if (!view.mutation) throw Error("Expected mutation");
    view.mutation = {
      ...view.mutation,
      deletion: { name: "Bracket A", image, sku: "SKU-42", productId: 42 },
    };
    renderWithClient(<DraftCard view={view} onAction={vi.fn()} />);
    expect(
      await screen.findByRole("region", { name: "Confirm product deletion" }),
    ).toHaveTextContent("Delete Bracket A?");
    expect(screen.getByText("Product #42 · SKU SKU-42")).toBeVisible();
    if (image)
      expect(screen.getByRole("img", { name: "Bracket A" })).toHaveAttribute(
        "src",
        image,
      );
    else expect(screen.getByText("Product image unavailable.")).toBeVisible();
  },
);

it.each(["create", "update", "delete"] as const)(
  "replaces completed %s controls with a concise summary and explicit remaining actions",
  async (kind) => {
    const onAction = vi.fn();
    const view = mutationCard(kind);
    if (!view.mutation) throw Error("Expected mutation");
    view.mutation.finished = true;
    view.mutation.operationId = "cleanup-operation";
    renderWithClient(<DraftCard view={view} onAction={onAction} />);
    expect(
      await screen.findByRole("region", { name: "Product completion" }),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: "Product Card" })).toBeNull();
    expect(screen.queryByLabelText("Correct a detail")).toBeNull();
    if (kind === "update") {
      fireEvent.click(
        screen.getByRole("button", { name: "Edit product details" }),
      );
      expect(onAction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: "correction",
          context: { draftId, field: "name" },
        }),
      );
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Check product operation" }),
    );
    expect(onAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "reconcile",
        context: { draftId, operationId: "cleanup-operation" },
      }),
    );
  },
);

it.each(["completed", "unresolved"] as const)(
  "locks draft corrections and catalog actions for a %s operation",
  async (state) => {
    const action = vi.fn();
    const card = mutationCard("update", true);
    const view: CardView = {
      ...card,
      mutation: {
        action: "update",
        ready: true,
        review: "Reviewed part",
        status: state,
        ...(state === "completed"
          ? { completed: true }
          : { operationId: "operation-1" }),
      },
      confirmations: [{ name: "Parts", confirmed: false }],
    };
    renderWithClient(<DraftCard view={view} onAction={action} />);
    expect(
      await screen.findByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Correct a detail")).toBeDisabled();
    for (const name of [
      "Save draft answers",
      "Review product changes",
      "Review product deletion",
      "Confirm new category: Parts",
    ])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    if (state === "unresolved")
      expect(
        screen.getByRole("button", { name: "Check product operation" }),
      ).toBeEnabled();
    expect(action).not.toHaveBeenCalled();
  },
);
