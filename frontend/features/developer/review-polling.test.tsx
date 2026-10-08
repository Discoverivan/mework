import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import type { MyPullRequest, PullRequestReviewState } from "@/shared/contracts/developer";

import { getPullRequestReviewStates } from "./api";
import { usePullRequestReviewPolling } from "./review-polling";

vi.mock("./api", () => ({
  getPullRequestReviewStates: vi.fn(),
}));

const getReviewStatesMock = vi.mocked(getPullRequestReviewStates);

const runningPullRequest: MyPullRequest = {
  integrationId: "integration-example",
  pullRequestId: "17",
  title: "Example change",
  state: "OPEN",
  repositorySlug: "example-repository",
  repositoryName: "Example Repository",
  projectKey: "EXAMPLE",
  sourceBranch: "feature/example",
  targetBranch: "main",
  authorDisplayName: "Example Author",
  latestCommit: "old-commit",
  myDecision: "not_reviewed",
  activity: "new",
  review: {
    runId: "run-example",
    status: "running",
    reviewedCommit: "old-commit",
    result: null,
    error: null,
    startedAt: 1,
    finishedAt: null,
  },
};

const otherCommitReview: PullRequestReviewState = {
  ...runningPullRequest.review!,
  status: "completed",
  reviewedCommit: "new-commit",
  finishedAt: 2,
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("usePullRequestReviewPolling", () => {
  it("batches running reviews every five seconds and ignores another commit's result", async () => {
    vi.useFakeTimers();
    getReviewStatesMock.mockResolvedValue({
      "integration-example:EXAMPLE:example-repository:17": otherCommitReview,
    });
    const { result, unmount } = renderHook(() => {
      const [values, setValues] = useState([runningPullRequest]);
      usePullRequestReviewPolling(values, setValues);
      return values;
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(getReviewStatesMock).toHaveBeenCalledTimes(1);
    expect(getReviewStatesMock).toHaveBeenCalledWith([{
      integrationId: "integration-example",
      projectKey: "EXAMPLE",
      repositorySlug: "example-repository",
      pullRequestId: "17",
      latestCommit: "old-commit",
    }]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getReviewStatesMock).toHaveBeenCalledTimes(2);
    expect(result.current[0].review?.status).toBe("running");
    unmount();
  });
});
