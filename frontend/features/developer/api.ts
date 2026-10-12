import { invoke } from "@tauri-apps/api/core";
import { APP_EVENT, emitAppEvent } from "@/app/app-events";
import type { ReviewCommentDiscussionScope, ReviewCommentDiscussion, ReviewCommentDecision } from "@/shared/contracts/developer";

export const getCommentDiscussions = (request: ReviewCommentDiscussionScope) =>
  invoke<ReviewCommentDiscussion[]>("pull_request_comment_discussions", { request });

export const sendCommentDiscussion = (request: ReviewCommentDiscussionScope & { index: number; revision: number; message: string }) =>
  invoke<ReviewCommentDiscussion>("pull_request_comment_discussion_send", { request });

export const decideCommentDiscussion = (request: ReviewCommentDiscussionScope & { index: number; revision: number; decision: ReviewCommentDecision; reason: string }) =>
  invoke<ReviewCommentDiscussion>("pull_request_comment_discussion_decide", { request });
import type {
  BitbucketProject,
  BitbucketRepository,
  BitbucketUser,
  MyPullRequest,
  MyPullRequestPage,
  PullRequestDiscussionStatus,
  PullRequestPublishableComment,
  PullRequestCommentMatches,
  PullRequestCommentMatchesRequest,
  PullRequestReviewSettings,
  PullRequestUnreadCounts,
  PullRequestUnreadCountsRequest,
  PullRequestReviewState,
  PullRequestReviewStateRequest,
  ReviewInstructionRule,
} from "@/shared/contracts/developer";

export const getPullRequestUnreadCounts = (request: PullRequestUnreadCountsRequest) =>
  invoke<PullRequestUnreadCounts>("bitbucket_pull_request_unread_counts", { request });

export const listMyPullRequests = (start = 0, limit = 100) =>
  invoke<MyPullRequestPage>("bitbucket_my_pull_requests", {
    request: { start, limit },
  });

type PullRequestScope = "reviewer" | "author";
const refreshes = new Map<string, Promise<MyPullRequestPage>>();
const reviewStarts = new Map<string, Promise<PullRequestReviewState>>();

function refreshPullRequests(scope: PullRequestScope, start: number, limit: number): Promise<MyPullRequestPage> {
  const key = JSON.stringify([scope, start, limit]);
  const existing = refreshes.get(key);
  if (existing) return existing;
  const promise = invoke<MyPullRequestPage>(scope === "reviewer" ? "bitbucket_my_pull_requests_refresh" : "bitbucket_authored_pull_requests_refresh", {
    request: { start, limit },
  }).then((page) => {
    emitAppEvent(scope === "reviewer" ? APP_EVENT.reviewerPullRequestsUpdated : APP_EVENT.authoredPullRequestsUpdated, page);
    return page;
  }).finally(() => { refreshes.delete(key); });
  refreshes.set(key, promise);
  return promise;
}

export const refreshMyPullRequests = (start = 0, limit = 100) => refreshPullRequests("reviewer", start, limit);

export const listAuthoredPullRequests = (start = 0, limit = 100) =>
  invoke<MyPullRequestPage>("bitbucket_authored_pull_requests", {
    request: { start, limit },
  });

export const refreshAuthoredPullRequests = (start = 0, limit = 100) => refreshPullRequests("author", start, limit);

export const markAuthoredPullRequestRead = (
  integrationId: string,
  key: string,
  latestCommit?: string,
) =>
  invoke<boolean>("authored_pull_request_mark_read", {
    integrationId,
    key,
    latestCommit,
  });
export const markAllAuthoredPullRequestsRead = () =>
  invoke<{ markedCount: number }>("authored_pull_requests_mark_all_read");

const invokeReviewStart = (pullRequest: MyPullRequest) =>
  invoke<PullRequestReviewState>("pull_request_review_start", {
    request: {
      integrationId: pullRequest.integrationId,
      projectKey: pullRequest.projectKey,
      repositorySlug: pullRequest.repositorySlug,
      pullRequestId: pullRequest.pullRequestId,
      title: pullRequest.title,
      state: pullRequest.state,
      repositoryName: pullRequest.repositoryName,
      sourceBranch: pullRequest.sourceBranch,
      targetBranch: pullRequest.targetBranch,
      authorDisplayName: pullRequest.authorDisplayName,
      authorAccountName: pullRequest.authorAccountName,
      authorAvatarUrl: pullRequest.authorAvatarUrl,
      updatedDate: pullRequest.updatedDate,
      myDecision: pullRequest.myDecision,
      activity: pullRequest.activity,
      latestCommit: pullRequest.latestCommit,
      url: pullRequest.url,
    },
  });

export function startPullRequestReview(pullRequest: MyPullRequest, scope: PullRequestScope = "reviewer"): Promise<PullRequestReviewState> {
  const key = JSON.stringify([pullRequest.integrationId, pullRequest.projectKey, pullRequest.repositorySlug, pullRequest.pullRequestId]);
  const existing = reviewStarts.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await invokeReviewStart(pullRequest);
    } catch (reason) {
      if (typeof reason !== "object" || reason === null || !("code" in reason) || reason.code !== "pull_request_changed") throw reason;
      // Retry read-only analysis once using the freshly polled snapshot, before any AI work started.
      const page = await refreshPullRequests(scope, 0, 100);
      const latest = page.values.find((item) => item.integrationId === pullRequest.integrationId
        && item.projectKey === pullRequest.projectKey && item.repositorySlug === pullRequest.repositorySlug && item.pullRequestId === pullRequest.pullRequestId);
      if (!latest || latest.state !== "OPEN") {
        throw { code: "pull_request_unavailable", retryable: false };
      }
      return await invokeReviewStart(latest);
    }
  })().finally(() => { reviewStarts.delete(key); });
  reviewStarts.set(key, promise);
  return promise;
}

export const getPullRequestReviewState = (pullRequest: MyPullRequest) =>
  invoke<PullRequestReviewState | null>("pull_request_review_state", {
    request: {
      authorAccountName: pullRequest.authorAccountName,
      integrationId: pullRequest.integrationId,
      projectKey: pullRequest.projectKey,
      repositorySlug: pullRequest.repositorySlug,
      pullRequestId: pullRequest.pullRequestId,
      latestCommit: pullRequest.latestCommit,
    },
  });

export const getPullRequestReviewStates = (requests: PullRequestReviewStateRequest[]) =>
  invoke<Record<string, PullRequestReviewState>>("pull_request_review_states", {
    request: { requests },
  });

export const markPullRequestRead = (
  integrationId: string,
  projectKey: string,
  repositorySlug: string,
  pullRequestId: string,
  latestCommit?: string,
) =>
  invoke<{ integrationId: string; pullRequestId: string; activity: "read" }>("pull_request_review_mark_read", {
    integrationId,
    projectKey,
    repositorySlug,
    pullRequestId,
    latestCommit,
  });

const discussionReadRequest = (pullRequest: MyPullRequest, commentId?: number) => ({
  integrationId: pullRequest.integrationId,
  projectKey: pullRequest.projectKey,
  repositorySlug: pullRequest.repositorySlug,
  pullRequestId: pullRequest.pullRequestId,
  throughRevision: pullRequest.discussion?.revision ?? 0,
  commentId,
});

export const markAllPullRequestsRead = (pullRequests: MyPullRequest[]) =>
  invoke<{ markedCount: number }>("pull_request_review_mark_all_read", {
    discussions: pullRequests.map((pullRequest) => ({ ...discussionReadRequest(pullRequest), latestCommit: pullRequest.latestCommit })),
  });

export const markPullRequestDiscussionRead = (pullRequest: MyPullRequest, commentId?: number) =>
  invoke<PullRequestDiscussionStatus>("pull_request_discussion_mark_read", {
    request: discussionReadRequest(pullRequest, commentId),
  });

export const publishPullRequestComment = (
  pullRequest: MyPullRequest,
  comment: PullRequestPublishableComment,
) =>
  invoke<{ commentId: number }>("pull_request_review_publish_comment", {
    request: {
      integrationId: pullRequest.integrationId,
      projectKey: pullRequest.projectKey,
      repositorySlug: pullRequest.repositorySlug,
      pullRequestId: pullRequest.pullRequestId,
      latestCommit: pullRequest.latestCommit,
      file: comment.file,
      line: comment.line,
      comment: comment.comment,
      parentCommentId: comment.parentCommentId,
    },
  });

export const setPullRequestDecision = (
  pullRequest: MyPullRequest,
  action: "approve" | "needs_work",
  idempotencyKey = crypto.randomUUID(),
) =>
  invoke<{ integrationId: string; pullRequestId: string; myDecision: "approved" | "needs_work" }>(
    "pull_request_review_set_decision",
    {
      request: {
        integrationId: pullRequest.integrationId,
        projectKey: pullRequest.projectKey,
        repositorySlug: pullRequest.repositorySlug,
        pullRequestId: pullRequest.pullRequestId,
        latestCommit: pullRequest.latestCommit,
        action,
        idempotencyKey,
      },
    },
  );

export const removePullRequestReviewer = (pullRequest: MyPullRequest, idempotencyKey: string) =>
  invoke<void>("pull_request_review_remove_reviewer", {
    request: {
      integrationId: pullRequest.integrationId,
      projectKey: pullRequest.projectKey,
      repositorySlug: pullRequest.repositorySlug,
      pullRequestId: pullRequest.pullRequestId,
      latestCommit: pullRequest.latestCommit,
      idempotencyKey,
    },
  });

export const searchBitbucketUsers = (query: string) =>
  invoke<BitbucketUser[]>("bitbucket_search_users", { query });

export const searchBitbucketProjects = (query: string) =>
  invoke<BitbucketProject[]>("bitbucket_search_projects", { query });

export const searchBitbucketRepositories = (query: string) =>
  invoke<BitbucketRepository[]>("bitbucket_search_repositories", { query });

export const getPullRequestReviewSettings = () =>
  invoke<PullRequestReviewSettings>("pull_request_review_settings");

export const getReviewInstructionRules = () => invoke<ReviewInstructionRule[]>("pull_request_review_instruction_rules");
export const saveReviewInstructionRules = (rules: ReviewInstructionRule[]) =>
  invoke<ReviewInstructionRule[]>("save_pull_request_review_instruction_rules", { rules }).then((saved) => {
    emitAppEvent(APP_EVENT.reviewInstructionRulesChanged);
    return saved;
  });

export const savePullRequestReviewSettings = (settings: PullRequestReviewSettings) =>
  invoke<PullRequestReviewSettings>("save_pull_request_review_settings", { settings }).then((saved) => {
    emitAppEvent(APP_EVENT.pullRequestActivityChanged);
    return saved;
  });

export const getPullRequestCommentMatches = (
  request: PullRequestCommentMatchesRequest,
) => invoke<PullRequestCommentMatches>("pull_request_review_comment_matches", {
  request,
});
