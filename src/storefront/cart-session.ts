import { useEffect, useEffectEvent } from "react";

/** Revalidates Better Auth after an expired cart request without discarding local bag state. */
export function useCartSessionRecovery(origin: string, refetch: () => unknown) {
  const refresh = useEffectEvent(async () => {
    try {
      await refetch();
    } catch {
      // The session hook owns its error UI; a failed read must not clear the bag.
    }
  });
  useEffect(() => {
    /** Bridges a private-request expiry to the latest session subscriber. */
    function onExpiry() {
      void refresh();
    }
    const event = `lulu-cart-expired:${origin}`;
    window.addEventListener(event, onExpiry);
    return () => window.removeEventListener(event, onExpiry);
  }, [origin]);
}
