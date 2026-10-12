import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";

import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import type { MyPullRequest, MyPullRequestPage, PullRequestReviewState } from "@/shared/contracts/developer";
import { startPullRequestReview } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("refreshes a changed PR and resumes one shared review attempt with its current snapshot", async () => {
  const stale: MyPullRequest = {
    integrationId: "example-integration", projectKey: "DEMO", repositorySlug: "sample-repository", pullRequestId: "7",
    title: "Example change", state: "OPEN", repositoryName: "Example repository", sourceBranch: "example", targetBranch: "main",
    authorDisplayName: "Example Author", myDecision: "not_reviewed", activity: "read", latestCommit: "commit-1",
    url: "https://bitbucket.example/projects/DEMO/repos/sample-repository/pull-requests/7",
  };
  const current = { ...stale, latestCommit: "commit-2", activity: "updated" as const };
  const page: MyPullRequestPage = { values: [current], hasMore: false };
  const running: PullRequestReviewState = {
    runId: "example-run", status: "running", reviewedCommit: "commit-2", startedAt: 1, finishedAt: null, error: null, result: null,
  };
  vi.mocked(invoke).mockRejectedValueOnce({ code: "pull_request_changed" }).mockResolvedValueOnce(page).mockResolvedValueOnce(running);
  const updated = vi.fn();
  const unsubscribe = subscribeAppEvent(APP_EVENT.reviewerPullRequestsUpdated, updated);
  try {
    const first = startPullRequestReview(stale);
    const repeated = startPullRequestReview(stale);
    expect(await first).toEqual(running);
    expect(await repeated).toEqual(running);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenNthCalledWith(1, "pull_request_review_start", { request: expect.objectContaining({ latestCommit: "commit-1" }) });
    expect(invoke).toHaveBeenNthCalledWith(2, "bitbucket_my_pull_requests_refresh", { request: { start: 0, limit: 100 } });
    expect(invoke).toHaveBeenNthCalledWith(3, "pull_request_review_start", { request: expect.objectContaining({ latestCommit: "commit-2" }) });
    expect(updated).toHaveBeenCalledOnce();
    expect(updated).toHaveBeenCalledWith(page);
  } finally {
    unsubscribe();
  }
});
