import { useEffect, useState } from "react";
import { APP_EVENT, emitAppEvent, subscribeAppEvent } from "@/app/app-events";

const DISMISSED_VERSION_KEY = "mework.update-banner.dismissed-version";

export function readDismissedUpdateVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_VERSION_KEY);
  } catch {
    return null;
  }
}

export function dismissUpdateNotice(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_VERSION_KEY, version);
  } catch {
    // The notice also keeps its dismissal in memory for this session.
  }
  emitAppEvent(APP_EVENT.updateNoticeDismissalChanged, version);
}

export function clearDismissedUpdateNotice(): void {
  try {
    window.localStorage.removeItem(DISMISSED_VERSION_KEY);
  } catch {
    // Subscribers still reset their in-memory dismissal.
  }
  emitAppEvent(APP_EVENT.updateNoticeDismissalChanged, null);
}

export function useDismissedUpdateVersion(): string | null {
  const [version, setVersion] = useState<string | null>(readDismissedUpdateVersion);
  useEffect(() => subscribeAppEvent(APP_EVENT.updateNoticeDismissalChanged, setVersion), []);
  return version;
}
