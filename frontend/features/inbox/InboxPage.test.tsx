import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listInbox, updateInboxState } from "./api";
import { InboxPage } from "./InboxPage";

vi.mock("./api", () => ({
  listInbox: vi.fn(),
  updateInboxState: vi.fn(),
}));

const listInboxMock = vi.mocked(listInbox);
const updateInboxStateMock = vi.mocked(updateInboxState);

const item = {
  id: "inbox-1",
  eventId: "event-1",
  subscriptionId: "subscription-1",
  title: "DEMO-1 status changed",
  reason: "matched subscription",
  severity: "medium",
  actionKind: "review",
  source: "jira",
  project: "DEMO",
  objectType: "jira_issue",
  externalId: "DEMO-1",
  sourceUrl: "https://jira.example/browse/DEMO-1",
  read: false,
  done: false,
  saved: false,
  archived: false,
  following: false,
  createdAt: "2026-09-04T00:00:00Z",
  updatedAt: "2026-09-04T00:00:00Z",
};

describe("InboxPage smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInboxMock.mockResolvedValue([item]);
    updateInboxStateMock.mockResolvedValue({ ...item, done: true });
  });

  it("renders an inbox item and completes its primary action", async () => {
    render(<InboxPage />);

    expect(await screen.findByText(item.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute("href", item.sourceUrl);

    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await waitFor(() => {
      expect(updateInboxStateMock).toHaveBeenCalledWith(item.id, { done: true });
    });
  });
});
