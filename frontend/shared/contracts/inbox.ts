export type InboxFilter = "all" | "unread" | "needs_my_action";

export interface InboxQuery {
  filter: InboxFilter;
  search?: string;
  limit: number;
  offset: number;
}

export interface InboxItem {
  id: string;
  eventId: string;
  subscriptionId: string;
  title: string;
  reason: string;
  severity: string;
  actionKind: string;
  source: string;
  project: string;
  objectType: string;
  externalId: string;
  sourceUrl: string;
  read: boolean;
  done: boolean;
  saved: boolean;
  archived: boolean;
  following: boolean;
  snoozeUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InboxStatePatch {
  read?: boolean;
  done?: boolean;
  saved?: boolean;
  archived?: boolean;
  following?: boolean;
  snoozeUntil?: string;
}
