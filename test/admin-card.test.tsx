import { A2uiSurface } from "@a2ui/react/v0_9";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { adminCatalog } from "../src/admin/card";
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
            fields: ["field"],
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
