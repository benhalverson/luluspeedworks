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

/** Credentials stay in React Hook Form, outside the A2UI/model data tree. */
export function AccountPanel() {
  const session = authClient.useSession();
  const location = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [, , removeSavedCart] = useLocalStorage(
    `lulu-cart-v1:${apiOrigin}`,
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
    onSuccess: async () => {
      await client.cancelQueries();
      client.clear();
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
  const pending = login.isPending || logout.isPending;
  const message = login.error?.message ?? logout.error?.message;
  return (
    <section
      aria-label="Account"
      className="col-span-full rounded border border-border p-5"
    >
      {session.isPending ? (
        <p role="status">Checking your session…</p>
      ) : session.data?.user ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>Signed in as {session.data.user.email}</p>
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
      {message ? (
        <p role="alert" className="mt-3">
          {message}
        </p>
      ) : null}
    </section>
  );
}
