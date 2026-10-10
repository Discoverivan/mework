import { useCallback, useRef, useState } from "react";

// Deduplicate active operations sharing a resource key; unrelated resources stay usable.
export function useKeyedOperation<Key>() {
  const activeKeys = useRef(new Set<Key>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<Key>>(() => new Set());

  const run = useCallback(async (key: Key, operation: () => Promise<void>) => {
    if (activeKeys.current.has(key)) return;
    activeKeys.current.add(key);
    setPendingKeys(new Set(activeKeys.current));
    try {
      await operation();
    } finally {
      activeKeys.current.delete(key);
      setPendingKeys(new Set(activeKeys.current));
    }
  }, []);

  return { pendingKeys, run };
}
