import type { A2uiClientAction } from "@a2ui/web_core/v0_9";
import {
  skipToken,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { BrandLink } from "../components/brand-link";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiOrigin, authClient } from "../storefront/auth";
import { ProductImage } from "../storefront/catalog";
import { useCatalog } from "../storefront/queries";
import { savedTransfer, selectFiles, transferFile } from "./attachments";
import { type CardView, DraftCard } from "./card";
import {
  type AttachmentTransfer,
  attachmentEnvelopeSchema,
  draftCleanupResponseSchema,
  type ProductDraft,
  type ProductDraftState,
  type ProductDraftSummary,
  type ProductDraftTarget,
  productDraftListSchema,
  productDraftResponseSchema,
} from "./contracts";
import { useDraftCreation } from "./creation";
import {
  type Action,
  actionSchema,
  type MutationResult,
  mutationResultSchema,
  preparationResponseSchema,
} from "./mutations";
import {
  DraftRequestError,
  draftRequest,
  isAuthorizationFailure,
} from "./request";

const fields = [
  "name",
  "description",
  "filamentType",
  "color",
  "notes",
  "markupPercentage",
  "inPersonPrice",
  "categoryNames",
  "categoryIds",
] as const;
const labels = {
  name: "Product name",
  description: "Description",
  filamentType: "Material",
  color: "Color",
  notes: "Notes",
  markupPercentage: "Online markup percentage",
  inPersonPrice: "In-person price (USD)",
  categoryNames: "Category names (one per line)",
  categoryIds: "Existing categories",
};
const title = (draft: ProductDraftSummary) =>
  draft.target.kind === "new"
    ? "New product"
    : `Product #${draft.target.productId}`;
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
/** Distinguish obsolete ownership from a request whose outcome needs recovery. */
class WorkspaceVisitEnded extends Error {}
type MutationAttempt = {
  draftId: string;
  preparationId: string;
  action: Action;
  operationId?: string;
};
type Selection = {
  kind: "photo" | "print";
  replacesId?: string;
  retry?: AttachmentTransfer;
};
type UploadQueue = {
  files: File[];
  selection: Selection;
  errors: string[];
  saved: number;
};
function selectionForDraft(
  selection: Selection,
  draft: ProductDraft | undefined,
): Selection {
  if (selection.retry) {
    const retryId = selection.retry.id;
    const transfer = draft?.attachments.transfers.find(
      (item) => item.id === retryId && item.status !== "saved",
    );
    return transfer ? { ...selection, retry: transfer } : { kind: "photo" };
  }
  if (
    selection.replacesId &&
    !draft?.attachments.photos.some(
      (item) => item.id === selection.replacesId,
    ) &&
    draft?.attachments.printFile?.id !== selection.replacesId
  )
    return { kind: "photo" };
  return selection;
}

export function AdminWorkspace() {
  const session = authClient.useSession();
  if (session.isPending)
    return (
      <main className="p-8">
        <p role="status">Checking your session…</p>
      </main>
    );
  if (session.error || !session.data?.user)
    return (
      <main className="p-8">
        <h1 className="font-display text-3xl">Sign in required</h1>
        <p className="my-4">
          Sign in to open your private product conversations.
        </p>
        <Link
          to="/signin?returnTo=%2Fadmin%2Fproducts"
          className="text-primary underline"
        >
          Sign in
        </Link>
      </main>
    );
  return (
    <AuthorizedWorkspace
      key={`${session.data.user.id}:${session.data.session?.id ?? ""}`}
      identity={session.data.user.id}
    />
  );
}

function AuthorizedWorkspace({ identity }: { identity: string }) {
  const client = useQueryClient();
  const [access, setAccess] = useState<{
    verified: boolean;
    denied: boolean;
    error: unknown;
  }>({ verified: false, denied: false, error: null });
  const { data: list = { drafts: [] } } = useQuery<
    z.infer<typeof productDraftListSchema>
  >({
    queryKey: ["admin-drafts", apiOrigin, identity],
    queryFn: skipToken,
    enabled: false,
    gcTime: 0,
  });
  // Only server verification may grant access; mutation cache writes cannot.
  const authorization = useQuery({
    queryKey: ["admin-draft-access", apiOrigin, identity],
    queryFn: async ({ signal }) => {
      const listKey = ["admin-drafts", apiOrigin, identity];
      const startedWith =
        client.getQueryData<z.infer<typeof productDraftListSchema>>(listKey);
      try {
        const result = await draftRequest(
          "",
          productDraftListSchema,
          "GET",
          undefined,
          signal,
        );
        signal.throwIfAborted();
        setAccess({ verified: true, denied: false, error: null });
        // A list read cannot undo acknowledgements received while it was pending.
        // A subsequent read starts from those acknowledgements and reconciles normally.
        client.setQueryData(
          listKey,
          (current: z.infer<typeof productDraftListSchema> | undefined) => {
            const changed = (current?.drafts ?? []).filter(
              (item) =>
                item !==
                startedWith?.drafts.find((prior) => prior.id === item.id),
            );
            return {
              drafts: [
                ...changed,
                ...result.drafts.filter(
                  (item) => !changed.some((saved) => saved.id === item.id),
                ),
              ],
            };
          },
        );
        return result;
      } catch (error) {
        signal.throwIfAborted();
        setAccess((previous) => ({
          verified: previous.verified && !isAuthorizationFailure(error),
          denied: previous.denied || isAuthorizationFailure(error),
          error,
        }));
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const status =
    access.error instanceof DraftRequestError ? access.error.status : null;
  if (
    !access.denied &&
    (authorization.isPending || !authorization.isFetchedAfterMount)
  )
    return (
      <main className="p-8">
        <p role="status">Checking administrator access…</p>
      </main>
    );
  if (
    access.denied ||
    !authorization.data ||
    (authorization.isError && !access.verified)
  )
    return (
      <main className="p-8">
        <p role="alert" className="mb-4">
          {status === 401
            ? "Your session has expired. Sign in again to continue."
            : status === 403
              ? "Private conversations unavailable. Administrator access is required."
              : "Private conversations unavailable. Please retry."}
        </p>
        {status === 401 ? (
          <Link
            to="/signin?returnTo=%2Fadmin%2Fproducts"
            className="text-primary underline"
          >
            Sign in
          </Link>
        ) : (
          <Button onClick={() => void authorization.refetch()}>
            Retry conversations
          </Button>
        )}
      </main>
    );
  return (
    <Workspace
      identity={identity}
      list={authorization}
      drafts={list.drafts}
      onAuthorizationFailure={(error) => {
        void client.cancelQueries({
          queryKey: ["admin-draft-access", apiOrigin, identity],
          exact: true,
        });
        setAccess({ verified: false, denied: true, error });
      }}
    />
  );
}

/** Coordinate one authorized workspace, serialized saves, and per-draft unsaved input. */
function Workspace({
  identity,
  list,
  drafts,
  onAuthorizationFailure,
}: {
  identity: string;
  list: UseQueryResult<z.infer<typeof productDraftListSchema>>;
  drafts: ProductDraftSummary[];
  onAuthorizationFailure: (error: DraftRequestError) => void;
}) {
  const mounted = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  /** A response belongs to the visit that initiated it, even during Strict Mode replay. */
  function assertVisit(owner: number) {
    if (!mounted.current || generation.current !== owner)
      throw new WorkspaceVisitEnded("Workspace visit ended");
  }
  /** Check ownership before dispatch and before any response continuation. */
  async function ownedRequest<T>(...args: Parameters<typeof draftRequest<T>>) {
    const owner = generation.current;
    assertVisit(owner);
    try {
      return await draftRequest(...args);
    } finally {
      assertVisit(owner);
    }
  }
  function stopRecovery(error: unknown, owner = generation.current) {
    if (
      !mounted.current ||
      generation.current !== owner ||
      error instanceof WorkspaceVisitEnded
    )
      return true;
    if (!isAuthorizationFailure(error)) return false;
    mounted.current = false;
    onAuthorizationFailure(error);
    return true;
  }
  const client = useQueryClient();
  const catalog = useCatalog(apiOrigin);
  const refreshCatalog = () =>
    client.resetQueries({ queryKey: ["catalog", apiOrigin] });
  const key = ["admin-drafts", apiOrigin, identity];
  const [savedId, setSavedId] = useLocalStorage<string | null>(
    `lulu-admin-draft:${apiOrigin}:${identity}`,
    null,
  );
  const [selected, setSelected] = useState<string | null>(savedId);
  const [cleanup, setCleanup] = useState<z.infer<
    typeof draftCleanupResponseSchema
  > | null>(null);
  const discarded = cleanup?.status === "discarded" ? cleanup : null;
  const active = drafts.filter((item) => item.status === "active");
  const id = discarded
    ? undefined
    : selected && active.some((item) => item.id === selected)
      ? selected
      : active[0]?.id;
  const draftKey = [...key, id];
  const detail = useQuery({
    queryKey: draftKey,
    enabled: Boolean(id),
    /** Keep a delayed read from replacing a newer acknowledged draft revision. */
    queryFn: async ({ signal }) => {
      try {
        const result = await ownedRequest(
          `/${id}`,
          productDraftResponseSchema,
          "GET",
          undefined,
          signal,
        );
        const current = client.getQueryData<ProductDraft>(draftKey);
        return current && current.revision > result.revision ? current : result;
      } catch (error) {
        if (!signal.aborted) stopRecovery(error);
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const draft = detail.data;
  /** Bind operation evidence to the initiating conversation before exposing actions. */
  async function operationRequest(
    draftId: string,
    suffix: string,
    method = "GET",
    body?: object,
    signal?: AbortSignal,
  ) {
    const result = await ownedRequest(
      `/${draftId}/${suffix}`,
      mutationResultSchema,
      method,
      body,
      signal,
    );
    if (result.operation && result.operation.draftId !== draftId)
      throw new Error("Saved operation does not belong to this draft.");
    return result;
  }
  const preparationKey = [...key, id, "preparation"];
  const operationKey = [...key, id, "operation"];
  const preparation = useQuery({
    queryKey: preparationKey,
    enabled: Boolean(draft),
    queryFn: async ({ signal }) => {
      try {
        const result = await ownedRequest(
          `/${id}/preparation`,
          preparationResponseSchema,
          "GET",
          undefined,
          signal,
        );
        signal.throwIfAborted();
        return result;
      } catch (error) {
        if (!signal.aborted) stopRecovery(error);
        throw error;
      }
    },
    retry: false,
    gcTime: 0,
  });
  const operation = useQuery({
    queryKey: operationKey,
    enabled: Boolean(draft),
    queryFn: async ({ signal }) => {
      try {
        const result = await operationRequest(
          String(id),
          "operation",
          "GET",
          undefined,
          signal,
        );
        signal.throwIfAborted();
        return result;
      } catch (error) {
        if (!signal.aborted) stopRecovery(error);
        throw error;
      }
    },
    retry: false,
    gcTime: 0,
  });
  const [view, setView] = useState<"products" | "conversations">(
    "conversations",
  );
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<
    Record<string, ProductDraftState["answers"]>
  >({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [correction, setCorrection] = useState<string>("name");
  const [editing, setEditing] = useState<string | null>(null);
  const [requestedSelection, setSelection] = useState<Selection>({
    kind: "photo",
  });
  const selection = selectionForDraft(requestedSelection, draft);
  const [queues, setQueues] = useState<Record<string, UploadQueue>>({});
  const queued = draft ? queues[draft.id] : undefined;
  const [notice, setNotice] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [requestedActions, setRequestedActions] = useState<
    Record<string, Action>
  >({});
  const mutationUnresolved = useRef<MutationAttempt | null>(null);
  const creation = useDraftCreation(identity);
  const creationUnresolved = creation.pending !== null;
  const locked = useRef(false);
  const photosInput = useRef<HTMLInputElement>(null);
  const printInput = useRef<HTMLInputElement>(null);
  const mutation = useMutation({
    scope: { id: `admin:${identity}` },
    mutationFn: (work: () => Promise<void>) => work(),
    retry: false,
  });
  const busy = mutation.isPending;
  const savedOperation = operation.data?.operation;
  const needsReconciliation = Boolean(
    savedOperation &&
      savedOperation.state !== "failed" &&
      savedOperation.state !== "succeeded",
  );
  const completed =
    savedOperation?.state === "succeeded" &&
    (draft?.target.kind === "new" || savedOperation.action === "delete");
  const disabled =
    busy || blocked || creationUnresolved || needsReconciliation || completed;
  const navigationDisabled =
    busy || blocked || creationUnresolved || needsReconciliation;
  const known =
    draft?.context.status === "available" ? draft.context : undefined;
  const answers = draft
    ? {
        ...(known
          ? {
              name: known.product.name,
              description: known.product.description,
              markupPercentage: known.product.markupPercentage?.toString(),
              inPersonPrice: known.product.inPersonPrice?.toFixed(2),
              filamentType: known.product.filamentType,
              color: known.product.color ?? "",
              categoryIds: known.categories.map(
                (category) => category.categoryId,
              ),
            }
          : {}),
        ...draft.state.answers,
        ...edits[draft.id],
      }
    : {};
  const serializedAnswers = {
    ...answers,
    ...(answers.categoryNames
      ? {
          categoryNames: answers.categoryNames
            .map((name) => name.trim())
            .filter(Boolean),
        }
      : {}),
  };
  const message = draft ? (messages[draft.id] ?? "") : "";
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (locked.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);

  /** Publish results only into the still-authorized mounted workspace. */
  function publish(next: ProductDraft) {
    const current = client.getQueryData<ProductDraft>([...key, next.id]);
    if (current && current.revision > next.revision) return;
    client.setQueryData([...key, next.id], next);
    client.setQueryData(
      key,
      (current: z.infer<typeof productDraftListSchema> | undefined) => ({
        drafts: [
          next,
          ...(current?.drafts ?? []).filter((item) => item.id !== next.id),
        ],
      }),
    );
  }
  async function reload(currentId: string) {
    const result = await ownedRequest(
      `/${currentId}`,
      productDraftResponseSchema,
    );
    publish(result);
    setBlocked(false);
    return result;
  }
  /** Acknowledged cleanup status must survive list reads already in flight. */
  function publishCleanup(next: z.infer<typeof draftCleanupResponseSchema>) {
    setCleanup(next);
    client.setQueryData(
      key,
      (current: z.infer<typeof productDraftListSchema> | undefined) => ({
        drafts: (current?.drafts ?? []).map((item) =>
          item.id === next.id && item.revision <= next.revision
            ? {
                ...item,
                revision: next.revision,
                status: next.status,
              }
            : item,
        ),
      }),
    );
  }
  async function refreshList(throwOnError = true) {
    const owner = generation.current;
    assertVisit(owner);
    await list.refetch({ throwOnError });
    assertVisit(owner);
  }
  /** Inspect durable evidence without replaying a provider effect. */
  async function recoverOperation(draftId: string) {
    const result = await operationRequest(draftId, "operation");
    client.setQueryData([...key, draftId, "operation"], result);
    const attempt = mutationUnresolved.current;
    if (result.operation && (!attempt || matchesAttempt(result, attempt))) {
      mutationUnresolved.current = null;
      setBlocked(false);
      if (result.operation.state === "succeeded") {
        await reload(draftId);
        await refreshCatalog();
      }
    }
    return result;
  }
  /** Older successful evidence cannot resolve a newer preparation's submission. */
  function matchesAttempt(result: MutationResult, attempt: MutationAttempt) {
    const current = result.operation;
    return Boolean(
      current &&
        current.draftId === attempt.draftId &&
        current.preparationId === attempt.preparationId &&
        current.action === attempt.action &&
        (!attempt.operationId || current.id === attempt.operationId),
    );
  }
  /** HTTP success is separate from durable completion and checkout readiness. */
  function operationNotice(result: MutationResult) {
    if (!result.operation || mutationUnresolved.current)
      return "The product operation outcome is unresolved. Reload saved state before retrying.";
    const current = result.operation;
    if (current.state !== "succeeded")
      return (
        current.error ||
        `Product operation ${current.state}. Resolve the saved operation before making another catalog change.`
      );
    if (current.action === "delete")
      return "Product deleted. Saved operation and file cleanup are retained.";
    return `Product ${current.action === "create" ? "created" : "updated"}. ${result.storefrontVisible ? "Visible in the storefront." : "Not visible in the storefront."} ${result.readiness?.checkoutReady ? "Ready for checkout." : `Checkout not ready: ${result.readiness?.reasons.join(", ") || "readiness unavailable"}.`}`;
  }
  function run(
    work: (assertCurrent: () => void) => Promise<void>,
    currentId: string | null | undefined = id,
    creationStarted: () => boolean = () => false,
    operationStarted: () => MutationAttempt | null = () => null,
  ) {
    if (locked.current || !mounted.current) return;
    const owner = generation.current;
    const assertCurrent = () => assertVisit(owner);
    locked.current = true;
    setNotice("Saving…");
    mutation.mutate(async () => {
      try {
        assertCurrent();
        await work(assertCurrent);
      } catch (error) {
        if (stopRecovery(error, owner)) return;
        setBlocked(true);
        const reason =
          error instanceof Error ? error.message : "Draft request failed.";
        try {
          const attempt = operationStarted();
          if (attempt) {
            mutationUnresolved.current = attempt;
            const result = await recoverOperation(attempt.draftId);
            setNotice(`${reason} ${operationNotice(result)}`);
            return;
          }
          if (creationStarted()) {
            await recoverCreation(assertCurrent);
            return;
          }
          if (creationUnresolved) {
            setNotice(
              `${reason} The creation outcome is unresolved. Keep this request and check again.`,
            );
            return;
          }
          if (currentId) {
            try {
              await reload(currentId);
            } catch (error) {
              if (stopRecovery(error, owner)) return;
              const tombstone = await ownedRequest(
                `/${currentId}/cleanup`,
                draftCleanupResponseSchema,
              );
              publishCleanup(tombstone);
              if (tombstone.status !== "discarded")
                throw new Error("Draft reload failed");
              setSelected(tombstone.id);
              setSavedId(null);
              await refreshList();
              setBlocked(false);
            }
          } else {
            await refreshList();
            setBlocked(false);
          }
          setNotice(
            `${reason} Saved state has been reloaded. Review it before retrying; your typed answers are retained.`,
          );
        } catch (error) {
          if (stopRecovery(error, owner)) return;
          setNotice(
            creationStarted() || creationUnresolved
              ? `${reason} The creation outcome is unresolved. Reload saved state to review conversations before leaving this workspace.`
              : `${reason} The saved outcome is unresolved. Reload saved state before making another change.`,
          );
        }
      } finally {
        locked.current = false;
      }
    });
  }
  /** Persist direct corrections without inference before moving to another draft. */
  async function saveCurrent(currentDraft: ProductDraft) {
    const result = await ownedRequest(
      `/${currentDraft.id}/prepare`,
      productDraftResponseSchema,
      "POST",
      { expectedRevision: currentDraft.revision, answers: serializedAnswers },
    );
    publish(result);
    clearEdits(currentDraft.id);
    return result;
  }
  function clearEdits(draftId: string) {
    setEdits((current) => {
      const next = { ...current };
      delete next[draftId];
      return next;
    });
  }
  function choose(next: ProductDraftSummary) {
    setCleanup(null);
    setSelected(next.id);
    setSavedId(next.status === "active" ? next.id : null);
    setView("conversations");
    setSelection({ kind: "photo" });
    setNotice("");
  }
  function acceptCreation(created: ProductDraft) {
    publish(created);
    choose(created);
    setEditing(created.id);
    setBlocked(false);
  }
  async function recoverCreation(assertCurrent: () => void) {
    const result = await creation.recover(acceptCreation, assertCurrent);
    setBlocked(result === "missing");
    setNotice(
      result === "found"
        ? "The original conversation has been recovered."
        : result === "discarded"
          ? "That conversation was discarded. You can start a new one."
          : "The creation outcome is unresolved. No conversation was found for this request. Retry this same request when ready.",
    );
  }
  /** Save dirty answers before opening a separate immutable-target conversation. */
  function open(target: ProductDraftTarget) {
    let creating = false;
    run(
      async (assertCurrent) => {
        if (draft && edits[draft.id]) await saveCurrent(draft);
        assertCurrent();
        const existing =
          target.kind === "existing"
            ? active.find(
                (item) =>
                  item.target.kind === "existing" &&
                  item.target.productId === target.productId,
              )
            : undefined;
        if (existing) choose(existing);
        else {
          await creation.begin(target, acceptCreation, assertCurrent, () => {
            creating = true;
          });
        }
      },
      id,
      () => creating,
    );
  }
  /** Route validated A2UI actions to draft preparation and explicitly confirmed category creation. */
  function cardAction(action: A2uiClientAction) {
    if (!draft || busy || action.context?.draftId !== draft.id) return;
    if (action.name === "reconcile") {
      if (
        !savedOperation ||
        action.context?.operationId !== savedOperation.id ||
        creationUnresolved ||
        !operationAllowed
      )
        return;
      const attempt: MutationAttempt = {
        draftId: draft.id,
        preparationId: savedOperation.preparationId,
        action: savedOperation.action,
        operationId: savedOperation.id,
      };
      run(
        async (assertCurrent) => {
          await client.cancelQueries({ queryKey: operationKey, exact: true });
          assertCurrent();
          const result = await operationRequest(draft.id, "reconcile", "POST", {
            operationId: savedOperation.id,
          });
          if (!matchesAttempt(result, attempt))
            throw new Error(
              "Product operation evidence does not match the confirmed action.",
            );
          client.setQueryData(operationKey, result);
          mutationUnresolved.current = null;
          setBlocked(false);
          setNotice(operationNotice(result));
          await reload(draft.id);
          await refreshCatalog();
        },
        draft.id,
        undefined,
        () => attempt,
      );
      return;
    }
    if (action.name === "manage") {
      if (
        mutationUnresolved.current ||
        savedOperation?.state !== "succeeded" ||
        savedOperation.action !== "create" ||
        action.context?.productId !== savedOperation.productId ||
        !savedOperation.productId
      )
        return;
      open({ kind: "existing", productId: savedOperation.productId });
      return;
    }
    if (disabled) return;
    if (action.name === "review") {
      const requested = actionSchema.safeParse(action.context?.action);
      if (
        !requested.success ||
        (draft.target.kind === "new"
          ? requested.data !== "create"
          : requested.data === "create")
      )
        return;
      setRequestedActions((current) => ({
        ...current,
        [draft.id]: requested.data,
      }));
      run(async (assertCurrent) => {
        const latest = edits[draft.id] ? await saveCurrent(draft) : draft;
        await client.cancelQueries({ queryKey: preparationKey, exact: true });
        assertCurrent();
        const result = await ownedRequest(
          `/${draft.id}/pricing/prepare`,
          preparationResponseSchema,
          "POST",
          { expectedRevision: latest.revision, action: requested.data },
        );
        client.setQueryData(preparationKey, result);
        setNotice(
          "Product review updated. Confirm the matching action to change the catalog.",
        );
      });
      return;
    }
    if (action.name === "submit") {
      const requested = actionSchema.safeParse(action.context?.action);
      if (
        !requested.success ||
        !canSubmit ||
        requested.data !== selectedAction ||
        !prepared
      )
        return;
      const attempt: MutationAttempt = {
        draftId: draft.id,
        preparationId: prepared.id,
        action: requested.data,
      };
      run(
        async (assertCurrent) => {
          await client.cancelQueries({ queryKey: operationKey, exact: true });
          assertCurrent();
          const result = await operationRequest(draft.id, "submit", "POST", {
            expectedRevision: draft.revision,
            preparationId: prepared.id,
            action: requested.data,
          });
          client.setQueryData(operationKey, result);
          if (!matchesAttempt(result, attempt)) {
            mutationUnresolved.current = attempt;
            setBlocked(true);
            setNotice(operationNotice(result));
            return;
          }
          setNotice(operationNotice(result));
          await reload(draft.id);
          await refreshCatalog();
        },
        draft.id,
        undefined,
        () => attempt,
      );
      return;
    }
    if (action.name === "confirmCategory") {
      const name = z.string().safeParse(action.context?.name);
      if (
        !name.success ||
        !draft.state.interpretation?.proposedCategoryNames.includes(name.data)
      )
        return;
      run(async () => {
        const next = await ownedRequest(
          `/${draft.id}/prepare`,
          productDraftResponseSchema,
          "POST",
          {
            expectedRevision: draft.revision,
            answers: serializedAnswers,
            confirmCategoryName: name.data,
          },
        );
        publish(next);
        clearEdits(draft.id);
        setNotice(
          "Category confirmation saved. Product creation remains unavailable.",
        );
      });
      return;
    }
    if (action.name === "correction") {
      const field = z.enum(fields).safeParse(action.context?.field);
      if (field.success) {
        setCorrection(field.data);
        setEditing(draft.id);
      }
      return;
    }
    if (action.name === "answer") {
      const result = z
        .object({ field: z.enum(fields), value: z.string() })
        .safeParse(action.context);
      if (result.success)
        setEdits((current) => ({
          ...current,
          [draft.id]: {
            ...current[draft.id],
            [result.data.field]:
              result.data.field === "categoryNames"
                ? result.data.value.split("\n")
                : result.data.field === "categoryIds"
                  ? result.data.value.split(",").filter(Boolean).map(Number)
                  : result.data.value,
            ...(result.data.field === "categoryIds"
              ? { categoryNames: [] }
              : {}),
          },
        }));
      return;
    }
    if (action.name === "save") {
      run(async () => {
        await saveCurrent(draft);
        setEditing(null);
        setNotice("Draft answers saved. No catalog changes were made.");
      });
      return;
    }
    const result = z
      .object({ id: z.string().uuid() })
      .safeParse(action.context);
    if (!result.success) return;
    const attachmentId = result.data.id;
    const photo = draft.attachments.photos.find(
      (item) => item.id === attachmentId,
    );
    const attachment =
      photo ??
      (draft.attachments.printFile?.id === attachmentId
        ? draft.attachments.printFile
        : undefined);
    const transfer = draft.attachments.transfers.find(
      (item) => item.id === attachmentId && item.status !== "saved",
    );
    if (action.name === "replace" || action.name === "reselect") {
      if (!attachment && !transfer) return;
      const next: Selection = transfer
        ? { kind: transfer.kind, retry: transfer }
        : { kind: photo ? "photo" : "print", replacesId: attachmentId };
      setSelection(next);
      setNotice(
        `Select ${transfer ? transfer.name : attachment?.name} in the composer.`,
      );
      (next.kind === "photo" ? photosInput : printInput).current?.focus();
      return;
    }
    if (!attachment && !transfer) return;
    if (action.name === "resolve" && transfer) {
      run(async () => {
        const result = await ownedRequest(
          `/${draft.id}/attachments/transfers/${transfer.id}/confirm`,
          attachmentEnvelopeSchema,
          "POST",
          { expectedRevision: draft.revision },
        );
        publish(result.draft);
        savedTransfer(result.draft, transfer.id);
        setNotice("Attachment saved.");
      });
      return;
    }
    run(async () => {
      let next: ProductDraft;
      if (action.name === "delete")
        next = (
          await ownedRequest(
            `/${draft.id}/attachments/${transfer?.attachmentId ?? attachmentId}?expectedRevision=${draft.revision}`,
            attachmentEnvelopeSchema,
            "DELETE",
          )
        ).draft;
      else if (photo && action.name === "primary")
        next = (
          await ownedRequest(
            `/${draft.id}/attachments`,
            attachmentEnvelopeSchema,
            "PATCH",
            { expectedRevision: draft.revision, primaryPhotoId: attachmentId },
          )
        ).draft;
      else if (
        photo &&
        (action.name === "earlier" || action.name === "later")
      ) {
        const order = [...draft.attachments.photoOrder];
        const index = order.indexOf(attachmentId);
        const destination = index + (action.name === "earlier" ? -1 : 1);
        if (index < 0 || destination < 0 || destination >= order.length) return;
        order.splice(index, 1);
        order.splice(destination, 0, attachmentId);
        next = (
          await ownedRequest(
            `/${draft.id}/attachments`,
            attachmentEnvelopeSchema,
            "PATCH",
            { expectedRevision: draft.revision, photoOrder: order },
          )
        ).draft;
      } else return;
      publish(next);
      setNotice(
        next.attachments.cleanup.some((item) => item.status === "pending")
          ? "Attachment changes saved. File cleanup pending."
          : "Attachment changes saved.",
      );
    });
  }
  function upload(files: File[], kind: "photo" | "print") {
    if (!draft || disabled) return;
    const selectedAction: Selection =
      selection.kind === kind
        ? selection
        : {
            kind,
            ...(kind === "print" && draft.attachments.printFile
              ? { replacesId: draft.attachments.printFile.id }
              : {}),
          };
    const checked = selectFiles(
      files,
      kind,
      draft,
      Boolean(selectedAction.replacesId || selectedAction.retry),
    );
    if (!checked.valid.length) {
      setNotice(checked.errors.join(" "));
      return;
    }
    setEditing(draft.id);
    continueUploads(draft, {
      files: checked.valid,
      selection: selectedAction,
      errors: checked.errors,
      saved: 0,
    });
  }
  function continueUploads(start: ProductDraft, queue: UploadQueue) {
    run(async (assertCurrent) => {
      let latest = start;
      const remaining = [...queue.files];
      const errors = [...queue.errors];
      let saved = queue.saved;
      function retain() {
        setQueues((current) => ({
          ...current,
          [start.id]: {
            ...queue,
            files: [...remaining],
            errors: [...errors],
            saved,
          },
        }));
      }
      for (const file of queue.files) {
        remaining.shift();
        retain();
        setNotice(`Transferring ${file.name}…`);
        try {
          latest = await transferFile(
            latest,
            file,
            queue.selection.kind,
            publish,
            queue.selection.replacesId,
            queue.selection.retry,
            assertCurrent,
          );
          saved++;
        } catch (error) {
          assertCurrent();
          if (stopRecovery(error)) return;
          errors.push(
            `${file.name}: ${error instanceof Error ? error.message : "Transfer failed."}`,
          );
          retain();
          latest = await reload(start.id);
          if (
            !(
              error instanceof DraftRequestError &&
              error.status >= 400 &&
              error.status < 500 &&
              error.status !== 409
            )
          ) {
            setNotice(errors.join(" "));
            return;
          }
        }
      }
      setQueues((current) => {
        const next = { ...current };
        delete next[start.id];
        return next;
      });
      setSelection({ kind: "photo" });
      setNotice(
        [
          saved ? "Attachments saved." : "No additional attachments saved.",
          ...errors,
        ].join(" "),
      );
    }, start.id);
  }
  const categorySummary = answers.categoryNames?.length
    ? answers.categoryNames.join(", ")
    : (answers.categoryIds ?? [])
        .map((categoryId) => `#${categoryId}`)
        .join(", ");
  const interpretation = draft?.state.interpretation;
  const prepared = preparation.data?.preparation;
  const operationAllowed =
    !mutationUnresolved.current ||
    Boolean(
      operation.data &&
        matchesAttempt(operation.data, mutationUnresolved.current),
    );
  const selectedAction: Action =
    (id && requestedActions[id]) ||
    (draft?.target.kind === "existing" &&
    prepared?.snapshot?.action === "delete"
      ? "delete"
      : undefined) ||
    (draft?.target.kind === "new" ? "create" : "update");
  const matchesTarget =
    prepared?.snapshot?.target.kind === draft?.target.kind &&
    (draft?.target.kind !== "existing" ||
      (prepared?.snapshot?.target.kind === "existing" &&
        prepared.snapshot.target.productId === draft.target.productId));
  const canSubmit = Boolean(
    draft &&
      !disabled &&
      !edits[draft.id] &&
      !queued?.files.length &&
      operation.isSuccess &&
      !(savedOperation && savedOperation.preparationId === prepared?.id) &&
      prepared?.status === "ready" &&
      prepared.readiness.ready &&
      prepared.draftRevision === draft.revision &&
      prepared.snapshot?.action === selectedAction &&
      matchesTarget,
  );
  const review = prepared
    ? [
        prepared.snapshot
          ? `${prepared.snapshot.name} · ${selectedAction}`
          : "Review unavailable",
        `Production cost: ${prepared.pricing.productionCost === null ? "Unavailable" : money.format(prepared.pricing.productionCost)}`,
        `Online price: ${prepared.pricing.onlinePrice === null ? "Unavailable" : money.format(prepared.pricing.onlinePrice)}`,
        `In-person price: ${prepared.pricing.inPersonPrice === null ? "Unavailable" : money.format(prepared.pricing.inPersonPrice)}`,
        ...prepared.validation.map((item) => item.message),
      ].join("\n")
    : "Review the product to verify pricing and catalog details.";
  const card: CardView | undefined = draft
    ? {
        draftId: draft.id,
        title:
          answers.name ||
          (draft.context.status === "available"
            ? draft.context.product.name
            : title(draft)),
        busy: busy || (blocked && !mutationUnresolved.current),
        mutation: {
          action: selectedAction,
          ready: canSubmit,
          completed: completed || Boolean(mutationUnresolved.current),
          review,
          status: operation.data?.operation
            ? operationNotice(operation.data)
            : preparation.isError || operation.isError
              ? "Saved product review unavailable. Review again before confirming an action."
              : prepared && prepared.draftRevision !== draft.revision
                ? "Review is stale. Review the latest draft before confirming."
                : prepared
                  ? `Product review ${prepared.status}.`
                  : "No catalog action has been prepared.",
          ...(operationAllowed &&
          savedOperation &&
          (needsReconciliation ||
            savedOperation.cleanup.some((item) => item.status === "pending"))
            ? { operationId: savedOperation.id }
            : {}),
          ...(!mutationUnresolved.current &&
          savedOperation?.state === "succeeded" &&
          savedOperation.action === "create" &&
          savedOperation.productId
            ? { productId: savedOperation.productId }
            : {}),
        },
        questions: draft.state.pendingQuestions
          .map((question) => question.prompt)
          .join("\n"),
        status: draft.attachments.validation
          .map((item) => item.message)
          .join(" "),
        confirmations: interpretation
          ? interpretation.proposedCategoryNames.map((name) => ({
              name,
              confirmed: interpretation.confirmedCategoryNames.includes(name),
            }))
          : [],
        summary: `${answers.description ?? ""}\nMaterial: ${answers.filamentType || "Not supplied"} · Color: ${answers.color || "Not supplied"}\nCategories: ${categorySummary || "Not supplied"}\n${known ? `Current catalog online price: ${money.format(known.product.price)} · ` : ""}Online markup: ${answers.markupPercentage || "Not supplied"}${answers.markupPercentage ? "%" : ""} · Proposed online price: awaiting server calculation · In-person price: ${answers.inPersonPrice || "Not supplied"}`,
        actionLabel:
          draft.target.kind === "new"
            ? "Create product — unavailable"
            : "Save changes — unavailable",
        fields: fields
          .filter(
            (field) =>
              (field === "categoryIds" &&
                draft.state.pendingQuestions.some(
                  (question) => question.id === "categoryNames",
                )) ||
              draft.state.pendingQuestions.some(
                (question) => question.id === field,
              ) ||
              (editing === draft.id && correction === field) ||
              field in (edits[draft.id] ?? {}),
          )
          .map((field) => ({
            field,
            options:
              field === "categoryIds"
                ? (catalog.snapshot?.categories ?? []).map((category) => ({
                    value: String(category.categoryId),
                    label: `${category.categoryName} (#${category.categoryId})`,
                  }))
                : field === "filamentType"
                  ? [
                      ...new Set(
                        draft.state.interpretation?.productionOptions.map(
                          (option) => option.material,
                        ) ?? [],
                      ),
                    ].map((value) => ({ value, label: value }))
                  : field === "color"
                    ? [
                        ...new Set(
                          draft.state.interpretation?.productionOptions
                            .filter(
                              (option) =>
                                option.material === answers.filamentType,
                            )
                            .map((option) => option.color) ?? [],
                        ),
                      ].map((value) => ({ value, label: value }))
                    : [],
            label: labels[field],
            value:
              field === "categoryNames"
                ? (answers.categoryNames ?? []).join("\n")
                : field === "categoryIds"
                  ? (answers.categoryIds ?? []).join(",")
                  : (answers[field] ?? ""),
            disabled,
          })),
        attachments:
          completed || draft.context.status === "unavailable"
            ? []
            : [
                ...draft.attachments.photoOrder.flatMap((photoId) =>
                  draft.attachments.photos.filter(
                    (photo) => photo.id === photoId,
                  ),
                ),
                ...(draft.attachments.printFile
                  ? [draft.attachments.printFile]
                  : []),
              ]
                .map((item, index) => ({
                  id: item.id,
                  name: item.name,
                  image: item.imageUrl
                    ? new URL(item.imageUrl, apiOrigin).href
                    : "",
                  status: "Saved",
                  photo: item.kind === "photo",
                  primary: item.id === draft.attachments.primaryPhotoId,
                  first: index === 0,
                  last: index === draft.attachments.photos.length - 1,
                  busy: disabled,
                  reselect: false,
                  resolve: false,
                }))
                .concat(
                  draft.attachments.transfers
                    .filter((item) => item.status !== "saved")
                    .map((item) => ({
                      id: item.id,
                      name: item.name,
                      image: "",
                      status: `${item.status === "pending" ? "Incomplete transfer" : item.status}${item.error ? `: ${item.error}` : ""}. ${item.requiresReselection ? "Reselect this file to continue." : "Reload to resolve this transfer."}`,
                      photo: false,
                      primary: false,
                      first: true,
                      last: true,
                      busy: disabled,
                      reselect:
                        item.kind === "print" || item.requiresReselection,
                      resolve:
                        item.kind === "print" || !item.requiresReselection,
                    })),
                ),
      }
    : undefined;
  const visibleProducts = catalog.snapshot?.products.filter((product) =>
    `${product.name} ${product.id} ${product.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const showCard =
    draft &&
    (editing === draft.id ||
      Boolean(edits[draft.id]) ||
      Boolean(draft.state.interpretation) ||
      draft.state.pendingQuestions.length > 0 ||
      draft.attachments.transfers.some((item) => item.status !== "saved") ||
      draft.attachments.validation.length > 0 ||
      Boolean(prepared) ||
      Boolean(savedOperation) ||
      mutationUnresolved.current?.draftId === draft.id);
  const history = draft
    ? draft.state.history.map((item, position) => ({
        ...item,
        id: `${draft.id}:${position}`,
      }))
    : [];
  const cleanupView = discarded
    ? discarded
    : draft && (draft.cleanupPending || draft.attachments.cleanup.length)
      ? {
          id: draft.id,
          revision: draft.revision,
          status: draft.status,
          cleanup: draft.attachments.cleanup,
        }
      : cleanup;
  const selectedSummary = drafts.find(
    (item) => item.id === (discarded?.id ?? id),
  );
  const cleanupPending =
    (discarded ? selectedSummary?.cleanupPending : draft?.cleanupPending) ||
    cleanupView?.cleanup.some((item) => item.status === "pending");
  return (
    <div className="mx-auto max-w-[1500px] px-4 tablet:px-9">
      <header className="flex flex-wrap items-center gap-4 border-b border-border py-5">
        <BrandLink
          onClick={(event) => {
            if (busy) event.preventDefault();
          }}
        />
        <div className="mr-auto">
          <p className="font-display text-2xl font-semibold">
            Product build log
          </p>
        </div>
        <nav
          aria-label="Admin navigation"
          className="order-3 flex w-full gap-2 tablet:order-none tablet:w-auto"
        >
          <Button
            variant={view === "products" ? "default" : "outline"}
            onClick={() => {
              if (view !== "products") void refreshCatalog();
              setView("products");
            }}
          >
            Products
          </Button>
          <Button
            variant={view === "conversations" ? "default" : "outline"}
            onClick={() => setView("conversations")}
          >
            Conversations
          </Button>
        </nav>
        <Button
          disabled={navigationDisabled || !list.isSuccess}
          onClick={() => open({ kind: "new" })}
        >
          + New product
        </Button>
      </header>
      <div className="grid min-w-0 gap-8 py-8 tablet:grid-cols-[minmax(0,1fr)_250px]">
        <main className="min-w-0">
          <p
            role="status"
            aria-label="Draft status"
            className="mb-4 whitespace-pre-wrap text-sm text-primary"
          >
            {notice}
          </p>
          {list.isError ? (
            <div role="alert">
              <p>Private conversations unavailable. Please retry.</p>
              <Button onClick={() => void list.refetch()}>
                Retry conversations
              </Button>
            </div>
          ) : null}
          {creationUnresolved ? (
            <p role="status">
              A conversation creation needs recovery before another can start.
            </p>
          ) : null}
          {creation.canRetry ? (
            <Button
              disabled={busy}
              onClick={() =>
                run(
                  async (assertCurrent) => {
                    await creation.retry(acceptCreation, assertCurrent);
                    setNotice("The original conversation has been recovered.");
                  },
                  id,
                  () => true,
                )
              }
            >
              Retry this conversation request
            </Button>
          ) : null}
          {blocked || creationUnresolved ? (
            <Button
              disabled={busy}
              onClick={() =>
                run(async (assertCurrent) => {
                  if (mutationUnresolved.current) {
                    const result = await recoverOperation(
                      mutationUnresolved.current.draftId,
                    );
                    setNotice(operationNotice(result));
                    return;
                  }
                  if (creationUnresolved) {
                    await recoverCreation(assertCurrent);
                    return;
                  }
                  if (id) await reload(id);
                  else {
                    await refreshList();
                    setBlocked(false);
                  }
                  setNotice("Saved state reloaded. Review before continuing.");
                }, id)
              }
            >
              Reload saved state
            </Button>
          ) : null}
          {view === "conversations" && cleanupView ? (
            <section
              aria-label="File cleanup"
              className="my-4 rounded border border-border p-4"
            >
              <h2 className="font-display text-xl">
                {cleanupView.status === "discarded"
                  ? "Draft discarded"
                  : "Attachment cleanup"}
              </h2>
              {cleanupPending ? <p>File cleanup pending.</p> : null}
              {cleanupView.cleanup.length ? (
                cleanupView.cleanup.map((item) => (
                  <p key={item.id}>
                    {item.status === "pending"
                      ? "File cleanup pending"
                      : item.status === "protected"
                        ? "Referenced file retained"
                        : "File deleted"}
                    {item.reason ? `: ${item.reason}` : ""}
                  </p>
                ))
              ) : !cleanupPending ? (
                <p>No file cleanup pending.</p>
              ) : null}
              <Button
                disabled={disabled}
                onClick={() =>
                  run(async () => {
                    const result = await ownedRequest(
                      `/${cleanupView.id}/cleanup/retry`,
                      draftCleanupResponseSchema,
                      "POST",
                      { expectedRevision: cleanupView.revision },
                    );
                    if (result.status === "active") {
                      await reload(result.id);
                      setCleanup(null);
                    } else {
                      publishCleanup(
                        await ownedRequest(
                          `/${result.id}/cleanup`,
                          draftCleanupResponseSchema,
                        ),
                      );
                      await refreshList();
                    }
                    setNotice("Cleanup state refreshed.");
                  }, cleanupView.id)
                }
              >
                Retry cleanup
              </Button>
            </section>
          ) : null}
          {view === "products" ? (
            <section aria-label="Products">
              <p className="text-xs tracking-widest text-primary">
                YOUR CATALOG
              </p>
              <h1 className="my-3 font-display text-5xl font-semibold">
                Products
              </h1>
              <Button
                variant="outline"
                className="mb-4"
                onClick={() => void refreshCatalog()}
              >
                Refresh catalog
              </Button>
              <label htmlFor="admin-search" className="grid gap-2">
                Search products
                <Input
                  id="admin-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or product ID"
                />
              </label>
              {!catalog.snapshot ? (
                <div className="my-5">
                  <p role="status">{catalog.status}</p>
                  {catalog.failed ? (
                    <Button onClick={() => void refreshCatalog()}>
                      Retry catalog
                    </Button>
                  ) : null}
                </div>
              ) : (
                <>
                  <p className="my-4 text-sm text-muted-foreground">
                    {visibleProducts?.length} listings. Select the exact product
                    ID to open its conversation.
                  </p>
                  <div className="grid gap-4 bench:grid-cols-2">
                    {visibleProducts?.map((product) => (
                      <button
                        type="button"
                        key={product.id}
                        disabled={navigationDisabled || !list.isSuccess}
                        onClick={() =>
                          open({ kind: "existing", productId: product.id })
                        }
                        className="rounded border border-border bg-card p-4 text-left focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                      >
                        <div className="mb-4">
                          <ProductImage
                            key={product.image}
                            src={product.image}
                            name=""
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Product #{product.id}
                        </span>
                        <h2 className="my-2 font-display text-2xl">
                          {product.name}
                        </h2>
                        <p className="text-sm">
                          Online {money.format(product.price)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {product.inPersonPrice == null
                            ? "In-person price unavailable"
                            : `In-person ${money.format(product.inPersonPrice)}`}
                        </p>
                        <p className="mt-4 text-primary">Manage product ↗</p>
                      </button>
                    ))}
                  </div>
                  {!visibleProducts?.length ? (
                    <p className="py-8">
                      {catalog.snapshot.products.length
                        ? "No products match your search."
                        : "No catalog products yet."}
                    </p>
                  ) : null}
                </>
              )}
            </section>
          ) : (
            <>
              <p className="text-xs tracking-widest text-primary">
                PRODUCT / DRAFT
              </p>
              <h1 className="mt-3 font-display text-5xl font-semibold">
                {draft
                  ? card?.title
                  : selectedSummary
                    ? title(selectedSummary)
                    : "An idea starts here"}
              </h1>
              <p className="my-4 text-muted-foreground">
                Keep the files and details for one product together.
              </p>
              {id && detail.isPending ? (
                <p role="status">Loading saved draft…</p>
              ) : null}
              {detail.isError ? (
                <div role="alert">
                  <p>Saved conversation unavailable.</p>
                  <Button onClick={() => void detail.refetch()}>
                    Retry draft
                  </Button>
                </div>
              ) : null}
              {!id && !discarded && list.isSuccess ? (
                <p className="py-8">
                  Select a product or start a new product conversation.
                </p>
              ) : null}
              {draft ? (
                <>
                  {draft.context.status === "unavailable" ? (
                    <p role="alert" className="my-4">
                      Product #{draft.context.productId} is unavailable. This
                      remains its original conversation.
                    </p>
                  ) : null}
                  {draft.context.status === "available" ? (
                    <div className="my-5 border-b border-border pb-5">
                      <p>
                        Product #{draft.context.product.id} · SKU{" "}
                        {draft.context.product.skuNumber ?? "unavailable"}
                      </p>
                      <p>{draft.context.product.description}</p>
                      <p>Online {money.format(draft.context.product.price)}</p>
                    </div>
                  ) : null}
                  <ol aria-label="Conversation history" className="space-y-5">
                    {history.map((item) => (
                      <li
                        key={item.id}
                        className="whitespace-pre-wrap break-words rounded bg-card p-4"
                      >
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">
                          {item.role === "user" ? "You" : "Assistant"}
                        </p>
                        {item.content}
                      </li>
                    ))}
                  </ol>
                  {showCard && card ? (
                    <DraftCard view={card} onAction={cardAction} />
                  ) : (
                    <div className="my-5">
                      <p className="text-sm text-muted-foreground">
                        Saved draft · {draft.attachments.photos.length} photos ·{" "}
                        {draft.attachments.printFile
                          ? draft.attachments.printFile.name
                          : "No print file"}
                      </p>
                      <Button
                        variant="outline"
                        className="my-5"
                        disabled={disabled}
                        onClick={() => setEditing(draft.id)}
                      >
                        Edit draft facts
                      </Button>
                    </div>
                  )}
                  <form
                    aria-label="Product conversation composer"
                    className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!message.trim() || disabled) return;
                      run(async () => {
                        const next = await ownedRequest(
                          `/${draft.id}/prepare`,
                          productDraftResponseSchema,
                          "POST",
                          {
                            expectedRevision: draft.revision,
                            answers: serializedAnswers,
                            message: message.trim(),
                          },
                        );
                        publish(next);
                        clearEdits(draft.id);
                        setEditing(null);
                        setMessages((current) => ({
                          ...current,
                          [draft.id]: "",
                        }));
                        setNotice(
                          next.state.interpretation?.explanation ??
                            "Draft preparation saved.",
                        );
                      });
                    }}
                  >
                    {queued?.files.length ? (
                      <section
                        aria-label="Queued attachments"
                        className="rounded border border-border p-3"
                      >
                        <p>
                          Not yet transferred. These files are still queued on
                          this device:
                        </p>
                        <p>
                          {queued.files.map((file) => file.name).join(", ")}
                        </p>
                        <Button
                          disabled={disabled}
                          onClick={() => continueUploads(draft, queued)}
                        >
                          Continue queued files
                        </Button>
                      </section>
                    ) : null}
                    <label className="grid gap-2 text-sm">
                      Product notes
                      <textarea
                        className="min-h-24 w-full rounded border border-border bg-background p-3 focus-visible:outline-2 focus-visible:outline-primary"
                        disabled={disabled}
                        value={message}
                        onChange={(event) =>
                          setMessages((current) => ({
                            ...current,
                            [draft.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="grid gap-3 bench:grid-cols-2">
                      <label
                        htmlFor="admin-photos"
                        className="grid gap-2 text-sm"
                      >
                        {selection.kind === "photo" &&
                        (selection.replacesId || selection.retry)
                          ? "Replacement / reselected photo"
                          : "Product photos (up to 5)"}
                        <Input
                          id="admin-photos"
                          ref={photosInput}
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp"
                          multiple={!selection.replacesId && !selection.retry}
                          disabled={disabled || Boolean(queued?.files.length)}
                          onChange={(event) => {
                            upload(
                              Array.from(event.target.files ?? []),
                              "photo",
                            );
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <label
                        htmlFor="admin-print"
                        className="grid gap-2 text-sm"
                      >
                        {selection.kind === "print" &&
                        (selection.replacesId || selection.retry)
                          ? "Replacement / reselected print file"
                          : "Print file"}
                        <Input
                          id="admin-print"
                          ref={printInput}
                          type="file"
                          disabled={disabled || Boolean(queued?.files.length)}
                          onChange={(event) => {
                            upload(
                              Array.from(event.target.files ?? []),
                              "print",
                            );
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Photos: JPG, PNG or WebP, up to 5,000,000 bytes each.
                      Files transfer when selected.
                    </p>
                    <Button
                      type="submit"
                      disabled={disabled || !message.trim()}
                    >
                      Send instruction
                    </Button>
                  </form>
                  <Button
                    variant="outline"
                    className="mt-5"
                    disabled={disabled}
                    onClick={() =>
                      run(async () => {
                        const result = await ownedRequest(
                          `/${draft.id}?expectedRevision=${draft.revision}`,
                          draftCleanupResponseSchema,
                          "DELETE",
                        );
                        publishCleanup(result);
                        setSelected(result.id);
                        setSavedId(null);
                        await refreshList(false);
                        setNotice(
                          "Draft discarded. Referenced files and submitted operations are retained.",
                        );
                      })
                    }
                  >
                    Discard draft
                  </Button>
                </>
              ) : null}
            </>
          )}
        </main>
        <aside
          aria-label="Recent conversations"
          className="min-w-0 border-t border-border pt-6 tablet:border-t-0 tablet:border-l tablet:pt-0 tablet:pl-6"
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest">
            Recent conversations
          </h2>
          <p className="my-3 text-sm text-muted-foreground">
            Continue a draft or a product update.
          </p>
          <ul className="space-y-2">
            {drafts.map((item) => (
              <li key={item.id}>
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start whitespace-normal py-3 text-left"
                  aria-pressed={item.id === (discarded?.id ?? id)}
                  disabled={navigationDisabled}
                  onClick={() =>
                    run(async () => {
                      if (item.status === "discarded") {
                        const result = await ownedRequest(
                          `/${item.id}/cleanup`,
                          draftCleanupResponseSchema,
                        );
                        choose(item);
                        publishCleanup(result);
                      } else choose(item);
                    })
                  }
                >
                  {title(item)}
                  <span className="text-xs text-muted-foreground">
                    {item.status === "discarded"
                      ? "Discarded · cleanup"
                      : "Unfinished"}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-9 border-t border-border pt-5 text-sm text-muted-foreground">
            ↳ Files and answers stay with their product conversation.
          </p>
        </aside>
      </div>
    </div>
  );
}
