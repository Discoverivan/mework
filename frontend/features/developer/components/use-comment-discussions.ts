import { useEffect, useRef, useState } from "react";
import type { ReviewCommentDecision, ReviewCommentDiscussion, ReviewCommentDiscussionScope } from "@/shared/contracts/developer";
import { decideCommentDiscussion, getCommentDiscussions, sendCommentDiscussion } from "../api";

export function useCommentDiscussions(open: boolean, scope: ReviewCommentDiscussionScope | undefined) {
  const scopeKey = scope ? JSON.stringify(scope) : "";
  const [state, setState] = useState<{ key: string; items: Map<number, ReviewCommentDiscussion>; loaded: boolean; failed: boolean }>({ key: "", items: new Map(), loaded: false, failed: false });
  const [attempt, setAttempt] = useState(0);
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState(new Set<string>());
  const [errors, setErrors] = useState(new Map<string, string>());

  function merge(key: string, items: ReviewCommentDiscussion[]) {
    setState(current => {
      if (current.key !== key) return current;
      const merged = new Map(current.items);
      for (const item of items) {
        if ((merged.get(item.index)?.revision ?? -1) <= item.revision) merged.set(item.index, item);
      }
      return { key, items: merged, loaded: true, failed: false };
    });
  }

  useEffect(() => {
    if (!open || !scopeKey) return;
    let active = true;
    setState(current => ({ key: scopeKey, items: current.key === scopeKey ? current.items : new Map(), loaded: false, failed: false }));
    void getCommentDiscussions(JSON.parse(scopeKey) as ReviewCommentDiscussionScope).then(items => {
      if (active) merge(scopeKey, items);
    }).catch(() => {
      if (active) setState(current => current.key === scopeKey ? { ...current, loaded: false, failed: true } : current);
    });
    return () => { active = false; };
  }, [open, scopeKey, attempt]);

  async function perform(index: number, action: "send" | ReviewCommentDecision, text: string) {
    if (!scope || state.key !== scopeKey || !state.loaded) return;
    const key = JSON.stringify([scopeKey, index]);
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPending(new Set(pendingRef.current));
    setErrors(current => { const next = new Map(current); next.delete(key); return next; });
    const request = { ...scope, index, revision: state.items.get(index)?.revision ?? 0 };
    try {
      const item = action === "send"
        ? await sendCommentDiscussion({ ...request, message: text })
        : await decideCommentDiscussion({ ...request, decision: action, reason: text });
      merge(scopeKey, [item]);
      return true;
    } catch (error) {
      setErrors(current => new Map(current).set(key, typeof error === "string" ? error : error instanceof Error ? error.message : ""));
      // A failed/interrupted provider request can still have a durable user turn.
      try { merge(scopeKey, await getCommentDiscussions(scope)); } catch { /* Keep the operation error visible. */ }
      return false;
    } finally {
      pendingRef.current.delete(key);
      setPending(new Set(pendingRef.current));
    }
  }

  return {
    items: state.key === scopeKey ? state.items : new Map<number, ReviewCommentDiscussion>(),
    ready: Boolean(scopeKey && state.key === scopeKey && state.loaded),
    failed: state.key === scopeKey && state.failed,
    retry: () => setAttempt(value => value + 1),
    pending: (index: number) => pending.has(JSON.stringify([scopeKey, index])),
    error: (index: number) => errors.get(JSON.stringify([scopeKey, index])),
    perform,
  };
}
