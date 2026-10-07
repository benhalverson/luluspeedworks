import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  type AccountFields,
  accountFields,
  accountRoute,
  apiOrigin,
  authClient,
  authenticate,
  returnDestination,
  signupFields,
} from "./auth";
import { useCart } from "./cart";
import { useCartSessionRecovery } from "./cart-session";
import { AddPasskey, supportsPasskeys } from "./passkey";
import { ProfilePanel } from "./profile";

/** Credentials stay in React Hook Form, outside the A2UI/model data tree. */
export function AccountPanel() {
  const session = authClient.useSession();
  const passkeysSupported = supportsPasskeys();
  useCartSessionRecovery(apiOrigin, session.refetch);
  const user = session.data?.user;
  const bag = useCart(
    apiOrigin,
    user?.id ?? null,
    !session.isPending && !session.error,
  );
  const location = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const visit = useRef(0);
  const current = useRef({
    identity: user?.id ?? null,
    path: location.key,
    version: 0,
  });
  if (
    current.current.identity !== (user?.id ?? null) ||
    current.current.path !== location.key
  )
    current.current.version += 1;
  current.current.identity = user?.id ?? null;
  current.current.path = location.key;
  useEffect(() => {
    visit.current += 1;
    return () => {
      visit.current += 1;
    };
  }, []);
  /** Bind account continuations to their mounted route and expected account. */
  function ownOperation() {
    const mounted = visit.current;
    const path = location.key;
    const identity = user?.id ?? null;
    const version = current.current.version;
    /** Authentication may establish its verified account, but cannot replace another account. */
    return (expected: string | null = identity) => {
      if (
        visit.current !== mounted ||
        current.current.path !== path ||
        (current.current.version !== version &&
          !(
            current.current.version === version + 1 &&
            current.current.identity === expected
          ))
      )
        throw new Error(
          "Your account changed. Please try again from this page.",
        );
    };
  }
  const route = accountRoute(location.pathname);
  const mode = route === "/signup" ? "signup" : "signin";
  const showingForm = route === "/signin" || route === "/signup";
  const destination = returnDestination(params.get("returnTo"));
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AccountFields>({
    resolver: zodResolver(mode === "signup" ? signupFields : accountFields),
    defaultValues: { email: "", password: "", name: "" },
  });
  const login = useMutation({
    retry: false,
    /** Complete verified authentication and cart handoff only for this account visit. */
    mutationFn: async ({
      kind,
      values,
    }: {
      kind: "signin" | "signup" | "passkey";
      values: AccountFields;
    }) => {
      const assertOwner = ownOperation();
      const authenticated = await authenticate(kind, values);
      assertOwner(authenticated.id);
      await client.cancelQueries();
      assertOwner(authenticated.id);
      client.clear();
      await bag.mutation.mutateAsync({
        kind: "claim",
        userId: authenticated.id,
      });
      assertOwner(authenticated.id);
      reset();
      await session.refetch();
      assertOwner(authenticated.id);
      navigate(destination, { replace: true });
    },
  });
  const logout = useMutation({
    retry: false,
    /** Sign out through Better Auth while retaining account-scoped bag restoration hints. */
    mutationFn: async () => {
      const assertOwner = ownOperation();
      const result = await authClient.signOut();
      assertOwner(null);
      if (result.error) throw new Error("Sign-out failed. Please try again.");
      await client.cancelQueries();
      assertOwner(null);
      client.clear();
      reset();
      await session.refetch();
      assertOwner(null);
      navigate("/", { replace: true });
    },
  });
  const restore = useMutation({
    retry: false,
    /** Retry an uncertain claim and resume the retained local destination. */
    mutationFn: async (userId: string) => {
      const assertOwner = ownOperation();
      await bag.mutation.mutateAsync({ kind: "claim", userId });
      assertOwner();
      if (showingForm) navigate(destination, { replace: true });
    },
  });
  const pending =
    login.isPending ||
    logout.isPending ||
    restore.isPending ||
    bag.mutation.isPending;
  const message =
    login.error?.message ??
    logout.error?.message ??
    restore.error?.message ??
    bag.mutation.error?.message;
  return (
    <section aria-label="Account" className="min-w-0">
      {session.isPending ? (
        <p role="status">Checking your session…</p>
      ) : user ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>Signed in as {user.email}</p>
          <Link
            className="underline"
            to={`/profile?returnTo=${encodeURIComponent(destination)}`}
          >
            Shipping profile
          </Link>
          {bag.claimable ? (
            <Button
              disabled={pending}
              onClick={() => {
                login.reset();
                logout.reset();
                restore.mutate(user.id);
              }}
            >
              Restore this bag
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => logout.mutate()}
          >
            Sign out
          </Button>
        </div>
      ) : showingForm ? (
        <>
          <h2 className="font-display text-2xl">
            {mode === "signup" ? "Create your account" : "Sign in"}
          </h2>
          <form
            className="mt-4 grid max-w-md gap-3"
            onSubmit={handleSubmit((values) =>
              login.mutate({ kind: mode, values }),
            )}
          >
            {mode === "signup" ? (
              <>
                <label htmlFor="account-name">Name</label>
                <Input
                  id="account-name"
                  autoComplete="name"
                  maxLength={100}
                  {...register("name")}
                />
              </>
            ) : null}
            <label htmlFor="account-email">Email</label>
            <Input
              id="account-email"
              autoComplete="username"
              type="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby="email-error"
              {...register("email")}
            />
            <p id="email-error" role="alert">
              {errors.email?.message}
            </p>
            <label htmlFor="account-password">Password</label>
            <Input
              id="account-password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              type="password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby="password-error"
              {...register("password")}
            />
            <p id="password-error" role="alert">
              {errors.password?.message}
            </p>
            {mode === "signin" ? (
              <Link
                className="underline"
                to={`/forgot-password?returnTo=${encodeURIComponent(destination)}`}
              >
                Forgot password?
              </Link>
            ) : null}
            <Button type="submit" disabled={pending}>
              {mode === "signup" ? "Create account" : "Sign in with password"}
            </Button>
          </form>
          {passkeysSupported ? (
            <Button
              className="mt-3"
              variant="outline"
              disabled={pending}
              onClick={() =>
                login.mutate({
                  kind: "passkey",
                  values: { email: "", password: "", name: "" },
                })
              }
            >
              Sign in with a passkey
            </Button>
          ) : null}
          <Link
            className="mt-3 block underline"
            to={`${mode === "signup" ? "/signin" : "/signup"}?returnTo=${encodeURIComponent(destination)}`}
            onClick={() => {
              reset();
              login.reset();
            }}
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "Create an account"}
          </Link>
          <p className="mt-3 text-sm">
            Your guest bag stays on this browser while you sign in.
          </p>
        </>
      ) : (
        <Link
          className="underline"
          to={`/signin?returnTo=${encodeURIComponent(location.pathname)}`}
        >
          Sign in or create an account
        </Link>
      )}
      {session.error ? (
        <p role="alert">
          Session unavailable. You can keep browsing and retry signing in.
        </p>
      ) : null}
      {user && !session.isPending && !session.error && route === "/profile" ? (
        <div key={user.id}>
          <ProfilePanel userId={user.id} />
          {passkeysSupported ? (
            <div className="mt-6 border-t border-border pt-5">
              <h2 className="font-display text-2xl">Account security</h2>
              <AddPasskey />
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="alert" className="mt-3">
          {message}
        </p>
      ) : null}
      {bag.mutation.isSuccess ? (
        <p role="status" className="mt-3">
          Your bag is restored.
        </p>
      ) : null}
    </section>
  );
}
