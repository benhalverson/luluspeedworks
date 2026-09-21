import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useLocalStorage } from "usehooks-ts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  type AccountFields,
  accountFields,
  apiOrigin,
  authClient,
  authenticate,
  returnDestination,
  signupFields,
} from "./auth";
import { useCart } from "./cart";
import { OrdersPanel } from "./orders";
import { AddPasskey } from "./passkey";
import { ProfilePanel } from "./profile";

/** Credentials stay in React Hook Form, outside the A2UI/model data tree. */
export function AccountPanel() {
  const session = authClient.useSession();
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
  const [, , removeSavedCart] = useLocalStorage(
    `lulu-cart-v2:${apiOrigin}`,
    null,
  );
  const mode = location.pathname === "/signup" ? "signup" : "signin";
  const showingForm =
    location.pathname === "/signin" || location.pathname === "/signup";
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
    mutationFn: ({
      kind,
      values,
    }: {
      kind: "signin" | "signup" | "passkey";
      values: AccountFields;
    }) => authenticate(kind, values),
    onSuccess: async (user) => {
      await client.cancelQueries();
      client.clear();
      await bag.mutation.mutateAsync({ kind: "claim", userId: user.id });
      reset();
      await session.refetch();
      navigate(destination, { replace: true });
    },
  });
  const logout = useMutation({
    retry: false,
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed. Please try again.");
      await client.cancelQueries();
      client.clear();
      removeSavedCart();
      reset();
      await session.refetch();
      navigate("/", { replace: true });
    },
  });
  const pending = login.isPending || logout.isPending || bag.mutation.isPending;
  const message =
    login.error?.message ??
    logout.error?.message ??
    bag.mutation.error?.message;
  return (
    <section
      aria-label="Account"
      className="col-span-full rounded border border-border p-5"
    >
      {session.isPending ? (
        <p role="status">Checking your session…</p>
      ) : user ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>Signed in as {user.email}</p>
          <Link className="underline" to="/profile">
            Shipping profile
          </Link>
          <Link className="underline" to="/orders">
            Your orders
          </Link>
          {bag.claimable ? (
            <Button
              disabled={pending}
              onClick={() =>
                bag.mutation.mutate({ kind: "claim", userId: user.id })
              }
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
            <Button type="submit" disabled={pending}>
              {mode === "signup" ? "Create account" : "Sign in with password"}
            </Button>
          </form>
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
      {user &&
      !session.isPending &&
      !session.error &&
      location.pathname === "/profile" ? (
        <div key={user.id}>
          <AddPasskey />
          <ProfilePanel userId={user.id} />
        </div>
      ) : null}
      {message ? (
        <p role="alert" className="mt-3">
          {message}
        </p>
      ) : null}
      {user &&
      !session.isPending &&
      !session.error &&
      (location.pathname === "/orders" ||
        location.pathname.startsWith("/orders/")) ? (
        <OrdersPanel key={user.id} userId={user.id} />
      ) : null}
    </section>
  );
}
