import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  accountFields,
  authClient,
  returnDestination,
  signupFields,
} from "./auth";

const requestFields = accountFields.pick({ email: true });
const resetFields = z
  .object({
    password: signupFields.shape.password,
    confirmation: z.string(),
  })
  .refine((values) => values.password === values.confirmation, {
    path: ["confirmation"],
    message: "Passwords must match.",
  });

export function resetCallback(origin: string, destination: string | null) {
  const url = new URL("/reset-password", origin);
  url.searchParams.set("returnTo", returnDestination(destination));
  return url.href;
}

function recoveryError(
  error: { status: number; code?: string },
  resetting: boolean,
) {
  if (error.status === 429)
    return "Too many attempts. Please wait a few minutes before trying again.";
  if (error.code === "INVALID_TOKEN")
    return "This reset link has expired or has already been used. Request another email.";
  if (resetting && (error.status === 400 || error.status === 422))
    return "Unable to reset your password. Check the 8–128 character limit or request a new reset link.";
  return "Password recovery is temporarily unavailable. Please try again later.";
}

export function RecoveryPage({ mode }: { mode: "request" | "reset" }) {
  const [params] = useSearchParams();
  const destination = returnDestination(params.get("returnTo"));
  const suffix = `?returnTo=${encodeURIComponent(destination)}`;
  const token = params.get("token") ?? "";
  const invalid = !token || params.get("error") === "INVALID_TOKEN";
  const navigate = useNavigate();
  const client = useQueryClient();
  const session = authClient.useSession();
  const [complete, setComplete] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const request = useForm<z.infer<typeof requestFields>>({
    resolver: zodResolver(requestFields),
    defaultValues: { email: "" },
  });
  const reset = useForm<z.infer<typeof resetFields>>({
    resolver: zodResolver(resetFields),
    defaultValues: { password: "", confirmation: "" },
  });
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Read credentials inside the mutation: never retain them in Query's variables.
  const mutation = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async () => {
      let result:
        | Awaited<ReturnType<typeof authClient.requestPasswordReset>>
        | Awaited<ReturnType<typeof authClient.resetPassword>>;
      try {
        result =
          mode === "request"
            ? await authClient.requestPasswordReset({
                email: requestFields.parse(request.getValues()).email,
                redirectTo: resetCallback(window.location.origin, destination),
              })
            : await authClient.resetPassword({
                token,
                newPassword: reset.getValues("password"),
              });
      } catch {
        throw new Error(
          mode === "request"
            ? "We could not confirm the request. An email may still arrive; check your inbox before trying again."
            : "We could not confirm the reset. Try signing in with your new password, or request another reset email.",
        );
      }
      if (result.error)
        throw new Error(recoveryError(result.error, mode === "reset"));
      setComplete(true);
      if (mode === "reset") {
        reset.reset();
        await navigate(`/reset-password${suffix}`, { replace: true });
        await client.cancelQueries();
        client.removeQueries();
        try {
          await session.refetch({ query: { disableCookieCache: true } });
        } catch {
          setRefreshFailed(true);
        }
      } else request.reset();
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const submit = () => {
    if (submitting.current) return;
    submitting.current = true;
    mutation.mutate();
  };
  const pending = mutation.isPending;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-6 py-10 tablet:py-16">
      <Link
        to="/"
        aria-label="Lulu Speedworks home"
        className="mb-10 flex items-center gap-3 self-start"
      >
        <span className="relative h-18.5 w-16 overflow-hidden rounded-full bg-white">
          <img
            src="/brand/lulu-logo.svg"
            alt="Lulu the dog with a racing badge"
            width="78"
            height="117"
            className="absolute -top-4.25 -left-1.75 h-auto w-19.5 max-w-none"
          />
        </span>
        <span className="-skew-x-7 font-display text-4xl font-bold leading-[0.8]">
          LULU
          <span className="mt-1.75 block text-xs tracking-[0.12em]">
            SPEEDWORKS
          </span>
        </span>
      </Link>
      <section
        className="rounded-xl border border-border bg-card p-6 tablet:p-8"
        aria-labelledby="recovery-title"
      >
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">
          Back to the bench
        </p>
        <h1
          id="recovery-title"
          ref={heading}
          tabIndex={-1}
          className="font-display text-4xl font-bold outline-none"
        >
          {mode === "request" ? "Forgot your password?" : "Reset your password"}
        </h1>
        {complete ? (
          <div className="mt-5 space-y-4">
            <p role="status">
              {mode === "request"
                ? "If this email exists in our system, check your email for the reset link."
                : "Your password has been reset. Sign in with your new password."}
            </p>
            {mode === "request" ? (
              <>
                <p className="text-muted-foreground">
                  The reset link expires in one hour.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setComplete(false);
                    mutation.reset();
                  }}
                >
                  Request another email
                </Button>
              </>
            ) : null}
            {mode === "reset" && (refreshFailed || session.error) ? (
              <p role="alert">
                Your password was changed, but we could not refresh your
                session. Reload the page before signing in.
              </p>
            ) : null}
          </div>
        ) : mode === "reset" && invalid ? (
          <p role="alert" className="mt-5">
            This reset link is missing, invalid, or expired. Request another
            email to continue.
          </p>
        ) : mode === "request" ? (
          <form
            noValidate
            className="mt-5 grid gap-3"
            onSubmit={request.handleSubmit(submit)}
          >
            <p className="mb-2 text-muted-foreground">
              Enter your account email and we’ll send you a reset link.
            </p>
            <label htmlFor="recovery-email">Email</label>
            <Input
              id="recovery-email"
              type="email"
              autoComplete="email"
              disabled={pending}
              aria-invalid={Boolean(request.formState.errors.email)}
              aria-describedby="recovery-email-error"
              {...request.register("email")}
            />
            <p id="recovery-email-error" role="alert">
              {request.formState.errors.email?.message}
            </p>
            <Button type="submit" disabled={pending}>
              {pending ? "Requesting email…" : "Send reset link"}
            </Button>
          </form>
        ) : (
          <form
            noValidate
            className="mt-5 grid gap-3"
            onSubmit={reset.handleSubmit(submit)}
          >
            <p className="mb-2 text-muted-foreground">
              Use 8–128 characters for your new password.
            </p>
            <label htmlFor="new-password">New password</label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              disabled={pending}
              aria-invalid={Boolean(reset.formState.errors.password)}
              aria-describedby="new-password-error"
              {...reset.register("password")}
            />
            <p id="new-password-error" role="alert">
              {reset.formState.errors.password?.message}
            </p>
            <label htmlFor="confirm-password">Confirm new password</label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              disabled={pending}
              aria-invalid={Boolean(reset.formState.errors.confirmation)}
              aria-describedby="confirm-password-error"
              {...reset.register("confirmation")}
            />
            <p id="confirm-password-error" role="alert">
              {reset.formState.errors.confirmation?.message}
            </p>
            <Button type="submit" disabled={pending}>
              {pending ? "Resetting password…" : "Reset password"}
            </Button>
          </form>
        )}
        {mutation.error ? (
          <p role="alert" className="mt-4">
            {mutation.error.message}
          </p>
        ) : null}
        <nav
          aria-label="Account recovery"
          className="mt-6 flex flex-col items-start gap-4 border-t border-border pt-5"
        >
          {mode === "reset" && !complete ? (
            <Link className="underline" to={`/forgot-password${suffix}`}>
              Request another email
            </Link>
          ) : null}
          <Link className="underline" to={`/signin${suffix}`}>
            Sign in
          </Link>
          <Link className="text-muted-foreground underline" to="/">
            Back to the store
          </Link>
        </nav>
      </section>
    </main>
  );
}
