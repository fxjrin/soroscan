import { useEffect, useState } from "react";
import { chainNow } from "@/lib/clock";

/**
 * Shared clock aligned to wall-clock second boundaries, so relative ages
 * and the ledger ring flip exactly when a real second rolls over (ledger
 * close times are whole seconds). Re-syncs immediately when the tab
 * becomes visible after background throttling.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => chainNow());

  useEffect(() => {
    let timer: number;

    function schedule() {
      timer = window.setTimeout(
        () => {
          setNow(chainNow());
          schedule();
        },
        1000 - (chainNow() % 1000) + 5, // land just past the chain-time boundary
      );
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        setNow(chainNow());
      }
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return now;
}
