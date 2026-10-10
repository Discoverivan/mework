import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import type {
  MyPullRequest,
  PullRequestReviewState,
  PullRequestReviewStateRequest,
} from "@/shared/contracts/developer";

import { getPullRequestReviewStates } from "./api";

const POLL_INTERVAL_MS = 5_000;
type ReviewMap = Record<string, PullRequestReviewState>;
type Source = {
  getRequests: () => PullRequestReviewStateRequest[];
  apply: (reviews: ReviewMap) => void;
};

const sources = new Set<Source>();
let timer: number | undefined;
let inFlight = false;

function requestKey(request: PullRequestReviewStateRequest): string {
  return `${request.integrationId}:${request.projectKey}:${request.repositorySlug}:${request.pullRequestId}`;
}

function requestIdentity(request: PullRequestReviewStateRequest): string {
  return JSON.stringify([requestKey(request), request.latestCommit ?? null]);
}

async function reconcileReviews() {
  if (inFlight) return;
  const requestsByKey = new Map<string, PullRequestReviewStateRequest>();
  for (const source of sources) {
    for (const request of source.getRequests()) requestsByKey.set(requestIdentity(request), request);
  }
  const requests = [...requestsByKey.values()];
  if (requests.length === 0) return;

  inFlight = true;
  try {
    const reviews = await getPullRequestReviewStates(requests);
    for (const source of sources) source.apply(reviews);
  } catch {
    // Keep the last known state and retry on the next scheduled tick.
  } finally {
    inFlight = false;
  }
}

function registerSource(source: Source): () => void {
  sources.add(source);
  if (timer == null) {
    void reconcileReviews();
    timer = window.setInterval(() => void reconcileReviews(), POLL_INTERVAL_MS);
  }
  return () => {
    sources.delete(source);
    if (sources.size === 0 && timer != null) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

export function usePullRequestReviewPolling(
  pullRequests: MyPullRequest[],
  setPullRequests: Dispatch<SetStateAction<MyPullRequest[]>>,
) {
  const pullRequestsRef = useRef(pullRequests);
  pullRequestsRef.current = pullRequests;

  useEffect(() => {
    const source: Source = {
      getRequests: () => pullRequestsRef.current
        .filter((pullRequest) => pullRequest.review?.status === "running")
        .map(({ integrationId, projectKey, repositorySlug, pullRequestId, latestCommit, authorAccountName }) => ({
          ...(authorAccountName ? { authorAccountName } : {}),
          integrationId,
          projectKey,
          repositorySlug,
          pullRequestId,
          latestCommit,
        })),
      apply: (reviews) => {
        setPullRequests((current) => {
          let changed = false;
          const next = current.map((pullRequest) => {
            const review = reviews[requestKey(pullRequest)];
            if (
              !review
              || pullRequest.review?.status !== "running"
              || pullRequest.review.runId !== review.runId
              || pullRequest.latestCommit !== review.reviewedCommit
            ) {
              return pullRequest;
            }
            changed = true;
            return { ...pullRequest, review };
          });
          return changed ? next : current;
        });
      },
    };
    return registerSource(source);
  }, [setPullRequests]);
}
