import { useMutation } from "@tanstack/react-query";
import { Button } from "../components/ui/button";
import { authClient } from "./auth";

export function AddPasskey() {
  const registration = useMutation({
    retry: false,
    mutationFn: async () => {
      const result = await authClient.passkey.addPasskey();
      if (result.error)
        throw new Error("Passkey could not be added. Please try again.");
    },
  });
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
