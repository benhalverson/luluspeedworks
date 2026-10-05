import { useMutation } from "@tanstack/react-query";
import { Button } from "../components/ui/button";
import { authClient } from "./auth";

/** Match the API's existing PASSKEY_ORIGIN; Lulu has no separately configured relying party. */
export function supportsPasskeys(origin = globalThis.location.origin) {
  return origin === "https://rc-store.benhalverson.dev";
}

/** Register credentials only from the API's explicitly supported passkey origin. */
export function AddPasskey() {
  const registration = useMutation({
    retry: false,
    /** Delegate the supported origin's registration ceremony to Better Auth. */
    mutationFn: async () => {
      const result = await authClient.passkey.addPasskey();
      if (result.error)
        throw new Error("Passkey could not be added. Please try again.");
    },
  });
  if (!supportsPasskeys()) return null;
  return (
    <div className="mt-4 grid gap-2">
      <Button
        variant="outline"
        disabled={registration.isPending}
        onClick={() => registration.mutate()}
      >
        Add a passkey
      </Button>
      {registration.isPending ? (
        <p role="status">Follow your device’s instructions to add a passkey.</p>
      ) : null}
      {registration.isSuccess ? (
        <p role="status">
          Passkey added. You can use it the next time you sign in.
        </p>
      ) : null}
      {registration.isError ? (
        <p role="alert">Passkey could not be added. Please try again.</p>
      ) : null}
    </div>
  );
}
