import {
  A2uiSurface,
  createComponentImplementation,
  type ReactComponentImplementation,
} from "@a2ui/react/v0_9";
import {
  type A2uiClientAction,
  Catalog,
  CommonSchemas,
  MessageProcessor,
} from "@a2ui/web_core/v0_9";
import { useEffect, useEffectEvent, useState } from "react";
import { z } from "zod";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

const Field = createComponentImplementation(
  {
    name: "DraftField",
    schema: z.object({
      draftId: CommonSchemas.DynamicString,
      field: CommonSchemas.DynamicString,
      label: CommonSchemas.DynamicString,
      value: CommonSchemas.DynamicString,
      disabled: CommonSchemas.DynamicBoolean,
      options: z.array(z.object({ value: z.string(), label: z.string() })),
    }),
  },
  /** Render only the current question or explicitly selected correction. */
  ({ props, context }) => (
    <label htmlFor={`draft-${props.field}`} className="grid gap-2 text-sm">
      {props.label}
      {props.options.length ? (
        <select
          id={`draft-${props.field}`}
          className="rounded border border-border bg-background p-2"
          multiple={props.field === "categoryIds"}
          value={
            props.field === "categoryIds" ? props.value.split(",") : props.value
          }
          disabled={props.disabled}
          onChange={(event) =>
            void context.dispatchAction({
              event: {
                name: "answer",
                context: {
                  draftId: props.draftId,
                  field: props.field,
                  value:
                    props.field === "categoryIds"
                      ? Array.from(
                          event.target.selectedOptions,
                          (option) => option.value,
                        ).join(",")
                      : event.target.value,
                },
              },
            })
          }
        >
          <option value="">Choose an option</option>
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : props.field === "categoryNames" ? (
        <textarea
          id={`draft-${props.field}`}
          className="min-h-20 rounded border border-border bg-background p-2"
          value={props.value}
          disabled={props.disabled}
          onChange={(event) =>
            void context.dispatchAction({
              event: {
                name: "answer",
                context: {
                  draftId: props.draftId,
                  field: props.field,
                  value: event.target.value,
                },
              },
            })
          }
        />
      ) : (
        <Input
          id={`draft-${props.field}`}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) =>
            void context.dispatchAction({
              event: {
                name: "answer",
                context: {
                  draftId: props.draftId,
                  field: props.field,
                  value: event.target.value,
                },
              },
            })
          }
        />
      )}
    </label>
  ),
);
/** Show a private saved photo with an honest failed-preview state. */
function AttachmentImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="my-3 text-sm text-muted-foreground">
      Saved photo preview unavailable.
    </p>
  ) : (
    <img
      src={src}
      alt={name}
      crossOrigin="use-credentials"
      onError={() => setFailed(true)}
      className="mb-3 h-28 w-full rounded object-contain"
    />
  );
}

const Attachment = createComponentImplementation(
  {
    name: "DraftAttachment",
    schema: z.object({
      draftId: CommonSchemas.DynamicString,
      attachmentId: CommonSchemas.DynamicString,
      name: CommonSchemas.DynamicString,
      image: CommonSchemas.DynamicString,
      status: CommonSchemas.DynamicString,
      photo: CommonSchemas.DynamicBoolean,
      primary: CommonSchemas.DynamicBoolean,
      first: CommonSchemas.DynamicBoolean,
      last: CommonSchemas.DynamicBoolean,
      busy: CommonSchemas.DynamicBoolean,
      reselect: CommonSchemas.DynamicBoolean,
      resolve: CommonSchemas.DynamicBoolean,
    }),
  },
  ({ props, context }) => {
    const dispatch = (name: string) =>
      void context.dispatchAction({
        event: {
          name,
          context: { id: props.attachmentId, draftId: props.draftId },
        },
      });
    return (
      <li className="rounded border border-border p-3">
        {props.image ? (
          <AttachmentImage
            key={props.image}
            src={props.image}
            name={props.name}
          />
        ) : null}
        <p className="break-all font-medium">{props.name}</p>
        <p className="my-2 text-sm text-muted-foreground">
          {props.status}
          {props.primary ? " · Primary photo" : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {props.photo ? (
            <>
              <Button
                variant="outline"
                disabled={props.busy || props.primary}
                onClick={() => dispatch("primary")}
              >
                Make primary
              </Button>
              <Button
                variant="outline"
                disabled={props.busy || props.first}
                onClick={() => dispatch("earlier")}
              >
                Move earlier
              </Button>
              <Button
                variant="outline"
                disabled={props.busy || props.last}
                onClick={() => dispatch("later")}
              >
                Move later
              </Button>
            </>
          ) : null}
          {!props.resolve || props.reselect ? (
            <Button
              variant="outline"
              disabled={props.busy}
              onClick={() => dispatch(props.reselect ? "reselect" : "replace")}
            >
              {props.reselect ? "Reselect file" : "Replace"}
            </Button>
          ) : null}
          {props.resolve ? (
            <Button
              variant="outline"
              disabled={props.busy}
              onClick={() => dispatch("resolve")}
            >
              Resolve transfer
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={props.busy}
            onClick={() => dispatch("delete")}
          >
            Delete
          </Button>
        </div>
      </li>
    );
  },
);
const mutationViewSchema = z.object({
  action: z.enum(["create", "update", "delete"]),
  ready: z.boolean(),
  review: z.string(),
  status: z.string(),
  operationId: z.string().optional(),
  completed: z.boolean().optional(),
  finished: z.boolean().optional(),
  deletion: z
    .object({
      name: z.string(),
      image: z.string(),
      sku: z.string(),
      productId: z.number(),
    })
    .optional(),
});
const mutationLabels = {
  create: "Create product",
  update: "Save changes",
  delete: "Delete product",
};

const ProductCard = createComponentImplementation(
  {
    name: "ProductCard",
    schema: z.object({
      draftId: CommonSchemas.DynamicString,
      title: CommonSchemas.DynamicString,
      summary: CommonSchemas.DynamicString,
      actionLabel: CommonSchemas.DynamicString,
      mutation: mutationViewSchema.optional(),
      fields: CommonSchemas.ChildList,
      attachments: CommonSchemas.ChildList,
      confirmations: z.array(
        z.object({ name: z.string(), confirmed: z.boolean() }),
      ),
      questions: CommonSchemas.DynamicString,
      busy: CommonSchemas.DynamicBoolean,
      status: CommonSchemas.DynamicString,
    }),
  },
  /** Render the single inline preparation card through approved A2UI bindings. */
  ({ props, buildChild, context }) => {
    const mutation = props.mutation;
    const catalogLocked =
      props.busy ||
      Boolean(mutation?.completed) ||
      Boolean(mutation?.operationId);
    if (mutation?.finished)
      return (
        <section
          aria-label="Product completion"
          className="my-6 rounded-lg border border-border bg-card p-4"
        >
          <h2 className="font-display text-2xl">{props.title}</h2>
          <p role="status" className="my-3">
            {mutation.status}
          </p>
          <p className="whitespace-pre-wrap text-sm">{mutation.review}</p>
          {mutation.action === "delete" ? (
            <p>
              This product is unavailable. Start a new product or select another
              conversation.
            </p>
          ) : (
            <p>Continue below to discuss further changes to this product.</p>
          )}
          {mutation.action === "update" ? (
            <Button
              variant="outline"
              disabled={props.busy}
              onClick={() =>
                void context.dispatchAction({
                  event: {
                    name: "correction",
                    context: { draftId: props.draftId, field: "name" },
                  },
                })
              }
            >
              Edit product details
            </Button>
          ) : null}
          {mutation.operationId ? (
            <Button
              variant="outline"
              disabled={props.busy}
              onClick={() =>
                void context.dispatchAction({
                  event: {
                    name: "reconcile",
                    context: {
                      draftId: props.draftId,
                      operationId: mutation.operationId,
                    },
                  },
                })
              }
            >
              Check product operation
            </Button>
          ) : null}
        </section>
      );
    return (
      <section
        aria-label="Product Card"
        className="my-6 rounded-lg border border-border bg-card p-4 tablet:p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Product Card
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold">
          {props.title}
        </h2>
        <p className="my-3 whitespace-pre-wrap text-sm text-muted-foreground">
          {props.questions}
        </p>
        <p className="my-3 text-sm">{props.summary}</p>
        <label className="my-3 grid gap-2 text-sm">
          Correct a detail
          <select
            className="rounded border border-border bg-background p-2"
            disabled={catalogLocked}
            value=""
            onChange={(event) =>
              void context.dispatchAction({
                event: {
                  name: "correction",
                  context: {
                    draftId: props.draftId,
                    field: event.target.value,
                  },
                },
              })
            }
          >
            <option value="" disabled>
              Choose a detail
            </option>
            <option value="name">Product name</option>
            <option value="description">Description</option>
            <option value="filamentType">Material</option>
            <option value="color">Color</option>
            <option value="markupPercentage">Online markup percentage</option>
            <option value="inPersonPrice">In-person price</option>
            <option value="categoryNames">Category names</option>
            <option value="categoryIds">Existing categories</option>
            <option value="notes">Notes</option>
          </select>
        </label>
        <div className="grid gap-4 bench:grid-cols-2">
          {props.fields.map((child) =>
            typeof child === "string"
              ? buildChild(child)
              : buildChild(child.id, child.basePath),
          )}
        </div>
        <ul
          aria-label="Draft attachments"
          className="my-5 grid gap-3 tablet:grid-cols-2"
        >
          {props.attachments.map((child) =>
            typeof child === "string"
              ? buildChild(child)
              : buildChild(child.id, child.basePath),
          )}
        </ul>
        {props.confirmations.map(({ name, confirmed }) => (
          <Button
            key={name}
            variant="outline"
            disabled={catalogLocked || confirmed}
            onClick={() =>
              void context.dispatchAction({
                event: {
                  name: "confirmCategory",
                  context: { draftId: props.draftId, name },
                },
              })
            }
          >
            {confirmed ? `Confirmed: ${name}` : `Confirm new category: ${name}`}
          </Button>
        ))}
        <p role="status" className="my-3 text-sm">
          {props.status}
        </p>
        <Button
          disabled={catalogLocked}
          onClick={() =>
            void context.dispatchAction({
              event: { name: "save", context: { draftId: props.draftId } },
            })
          }
        >
          Save draft answers
        </Button>
        <p className="my-3 text-sm text-muted-foreground">
          {mutation
            ? "Review prices and details, then explicitly confirm the catalog action. Saving draft answers does not change the catalog."
            : "Preparation only. Saving answers never creates, publishes, updates or deletes a product."}
        </p>
        {mutation ? (
          <div className="grid gap-3">
            {mutation.deletion ? (
              <section
                aria-label="Confirm product deletion"
                className="rounded border border-destructive p-3"
              >
                <h3 className="font-semibold">
                  Delete {mutation.deletion.name}?
                </h3>
                <p>
                  Product #{mutation.deletion.productId} · SKU{" "}
                  {mutation.deletion.sku}
                </p>
                {mutation.deletion.image ? (
                  <AttachmentImage
                    src={mutation.deletion.image}
                    name={mutation.deletion.name}
                  />
                ) : (
                  <p>Product image unavailable.</p>
                )}
                <p>Confirm only this product. Deletion cannot be undone.</p>
              </section>
            ) : null}
            <p className="whitespace-pre-wrap text-sm">{mutation.review}</p>
            <p role="status" className="text-sm">
              {mutation.status}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={catalogLocked}
                onClick={() =>
                  void context.dispatchAction({
                    event: {
                      name: "review",
                      context: {
                        draftId: props.draftId,
                        action: mutation.action,
                      },
                    },
                  })
                }
              >
                Review{" "}
                {mutation.action === "delete"
                  ? "product deletion"
                  : "product changes"}
              </Button>
              {mutation.action !== "create" ? (
                <Button
                  variant="outline"
                  disabled={catalogLocked}
                  onClick={() =>
                    void context.dispatchAction({
                      event: {
                        name:
                          mutation.action === "delete"
                            ? "cancelDelete"
                            : "review",
                        context: {
                          draftId: props.draftId,
                          action:
                            mutation.action === "update" ? "delete" : "update",
                        },
                      },
                    })
                  }
                >
                  {mutation.action === "update"
                    ? "Review product deletion"
                    : "Cancel deletion"}
                </Button>
              ) : null}
              <Button
                disabled={catalogLocked || !mutation.ready}
                onClick={() =>
                  void context.dispatchAction({
                    event: {
                      name: "submit",
                      context: {
                        draftId: props.draftId,
                        action: mutation.action,
                      },
                    },
                  })
                }
              >
                {mutationLabels[mutation.action]}
              </Button>
              {mutation.operationId ? (
                <Button
                  variant="outline"
                  disabled={props.busy}
                  onClick={() =>
                    void context.dispatchAction({
                      event: {
                        name: "reconcile",
                        context: {
                          draftId: props.draftId,
                          operationId: mutation.operationId,
                        },
                      },
                    })
                  }
                >
                  Check product operation
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <Button disabled>{props.actionLabel}</Button>
        )}
      </section>
    );
  },
);
export const adminCatalog = new Catalog(
  "https://luluspeedworks.com/catalog/admin/v1",
  [ProductCard, Field, Attachment],
);
export type CardView = {
  draftId: string;
  title: string;
  summary: string;
  actionLabel: string;
  mutation?: z.infer<typeof mutationViewSchema>;
  confirmations: { name: string; confirmed: boolean }[];
  questions: string;
  status: string;
  busy: boolean;
  fields: {
    field: string;
    label: string;
    value: string;
    disabled: boolean;
    options: { value: string; label: string }[];
  }[];
  attachments: {
    id: string;
    name: string;
    image: string;
    status: string;
    photo: boolean;
    primary: boolean;
    first: boolean;
    last: boolean;
    busy: boolean;
    reselect: boolean;
    resolve: boolean;
  }[];
};
/** Own one real A2UI surface and update its bound data in place. */
export function DraftCard({
  view,
  onAction,
}: {
  view: CardView;
  onAction: (action: A2uiClientAction) => void;
}) {
  const action = useEffectEvent(onAction);
  const [processor, setProcessor] =
    useState<MessageProcessor<ReactComponentImplementation>>();
  useEffect(() => {
    const next = new MessageProcessor(
      [adminCatalog],
      (event) => action(event),
      {
        version: "v0.9.1",
      },
    );
    next.processMessages([
      {
        version: "v0.9.1",
        createSurface: { surfaceId: "draft", catalogId: adminCatalog.id },
      },
      {
        version: "v0.9.1",
        updateComponents: {
          surfaceId: "draft",
          components: [
            {
              id: "root",
              component: "ProductCard",
              draftId: { path: "/draftId" },
              title: { path: "/title" },
              summary: { path: "/summary" },
              actionLabel: { path: "/actionLabel" },
              questions: { path: "/questions" },
              status: { path: "/status" },
              busy: { path: "/busy" },
              fields: { componentId: "field", path: "/fields" },
              confirmations: [],
              attachments: { componentId: "attachment", path: "/attachments" },
            },
            {
              id: "field",
              component: "DraftField",
              draftId: { path: "/draftId" },
              field: { path: "field" },
              label: { path: "label" },
              value: { path: "value" },
              disabled: { path: "disabled" },
              options: [],
            },
            {
              id: "attachment",
              component: "DraftAttachment",
              draftId: { path: "/draftId" },
              ...Object.fromEntries(
                [
                  "name",
                  "image",
                  "status",
                  "photo",
                  "primary",
                  "first",
                  "last",
                  "busy",
                  "reselect",
                  "resolve",
                ].map((key) => [key, { path: key }]),
              ),
              attachmentId: { path: "id" },
            },
          ],
        },
      },
    ]);
    setProcessor(next);
    return () => next.model.dispose();
  }, []);
  useEffect(() => {
    processor?.processMessages([
      {
        version: "v0.9.1",
        updateComponents: {
          surfaceId: "draft",
          components: [
            {
              id: "root",
              component: "ProductCard",
              draftId: { path: "/draftId" },
              title: { path: "/title" },
              summary: { path: "/summary" },
              actionLabel: { path: "/actionLabel" },
              questions: { path: "/questions" },
              status: { path: "/status" },
              busy: { path: "/busy" },
              fields: view.fields.map((field) => `field-${field.field}`),
              attachments: { componentId: "attachment", path: "/attachments" },
              confirmations: view.confirmations,
              ...(view.mutation ? { mutation: view.mutation } : {}),
            },
            ...view.fields.map((field) => ({
              id: `field-${field.field}`,
              component: "DraftField",
              draftId: view.draftId,
              ...field,
            })),
          ],
        },
      },
      {
        version: "v0.9.1",
        updateDataModel: { surfaceId: "draft", path: "/", value: view },
      },
    ]);
  }, [processor, view]);
  const surface = processor?.model.getSurface("draft");
  return surface ? <A2uiSurface surface={surface} /> : null;
}
