import { invoke } from "@tauri-apps/api/core";
import type {
  BitbucketRepository,
  BitbucketUser,
  MyPullRequest,
  MyPullRequestPage,
  PullRequestReviewComment,
  PullRequestReviewSettings,
  PullRequestUnreadCounts,
  PullRequestReviewState,
} from "@/shared/contracts/developer";

export const getPullRequestUnreadCounts = () =>
  invoke<PullRequestUnreadCounts>("bitbucket_pull_request_unread_counts");

export const listMyPullRequests = (start = 0, limit = 100) =>
  invoke<MyPullRequestPage>("bitbucket_my_pull_requests", {
    request: { start, limit },
  });

export const refreshMyPullRequests = (start = 0, limit = 100) =>
  invoke<MyPullRequestPage>("bitbucket_my_pull_requests_refresh", {
    request: { start, limit },
  });

export const listAuthoredPullRequests = (start = 0, limit = 100) =>
  invoke<MyPullRequestPage>("bitbucket_authored_pull_requests", {
    request: { start, limit },
  });

export const refreshAuthoredPullRequests = (start = 0, limit = 100) =>
  invoke<MyPullRequestPage>("bitbucket_authored_pull_requests_refresh", {
    request: { start, limit },
  });

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

export const startPullRequestReview = (pullRequest: MyPullRequest) =>
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
      authorAvatarUrl: pullRequest.authorAvatarUrl,
      updatedDate: pullRequest.updatedDate,
      myDecision: pullRequest.myDecision,
      activity: pullRequest.activity,
      latestCommit: pullRequest.latestCommit,
      url: pullRequest.url,
    },
  });

export const getPullRequestReviewState = (pullRequest: MyPullRequest) =>
  invoke<PullRequestReviewState | null>("pull_request_review_state", {
    request: {
      integrationId: pullRequest.integrationId,
      projectKey: pullRequest.projectKey,
      repositorySlug: pullRequest.repositorySlug,
      pullRequestId: pullRequest.pullRequestId,
      latestCommit: pullRequest.latestCommit,
    },
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

export const markAllPullRequestsRead = () =>
  invoke<{ markedCount: number }>("pull_request_review_mark_all_read");

export const publishPullRequestComment = (
  pullRequest: MyPullRequest,
  comment: PullRequestReviewComment,
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
    },
  });

export const setPullRequestDecision = (
  pullRequest: MyPullRequest,
  action: "approve" | "needs_work",
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
      },
    },
  );

export const searchBitbucketUsers = (query: string) =>
  invoke<BitbucketUser[]>("bitbucket_search_users", { query });

export const searchBitbucketRepositories = (query: string) =>
  invoke<BitbucketRepository[]>("bitbucket_search_repositories", { query });

export const getPullRequestReviewSettings = () =>
  invoke<PullRequestReviewSettings>("pull_request_review_settings");

export const savePullRequestReviewSettings = (settings: PullRequestReviewSettings) =>
  invoke<PullRequestReviewSettings>("save_pull_request_review_settings", { settings });
