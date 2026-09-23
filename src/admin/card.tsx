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
    }),
  },
  ({ props, context }) => (
    <label htmlFor={`draft-${props.field}`} className="grid gap-2 text-sm">
      {props.label}
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
    </label>
  ),
);
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
const ProductCard = createComponentImplementation(
  {
    name: "ProductCard",
    schema: z.object({
      draftId: CommonSchemas.DynamicString,
      title: CommonSchemas.DynamicString,
      fields: CommonSchemas.ChildList,
      attachments: CommonSchemas.ChildList,
      questions: CommonSchemas.DynamicString,
      busy: CommonSchemas.DynamicBoolean,
      status: CommonSchemas.DynamicString,
    }),
  },
  ({ props, buildChild, context }) => (
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
      <p role="status" className="my-3 text-sm">
        {props.status}
      </p>
      <Button
        disabled={props.busy}
        onClick={() =>
          void context.dispatchAction({
            event: { name: "save", context: { draftId: props.draftId } },
          })
        }
      >
        Save draft answers
      </Button>
    </section>
  ),
);
export const adminCatalog = new Catalog(
  "https://luluspeedworks.com/catalog/admin/v1",
  [ProductCard, Field, Attachment],
);
export type CardView = {
  draftId: string;
  title: string;
  questions: string;
  status: string;
  busy: boolean;
  fields: { field: string; label: string; value: string; disabled: boolean }[];
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
              questions: { path: "/questions" },
              status: { path: "/status" },
              busy: { path: "/busy" },
              fields: { componentId: "field", path: "/fields" },
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
        updateDataModel: { surfaceId: "draft", path: "/", value: view },
      },
    ]);
  }, [processor, view]);
  const surface = processor?.model.getSurface("draft");
  return surface ? <A2uiSurface surface={surface} /> : null;
}
