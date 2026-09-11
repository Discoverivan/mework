import { invoke } from "@tauri-apps/api/core";
import type {
  BitbucketRepository,
  BitbucketUser,
  MyPullRequest,
  MyPullRequestPage,
  PullRequestReviewSettings,
  PullRequestReviewState,
} from "@/shared/contracts/developer";

export const listMyPullRequests = (start = 0, limit = 100) =>
  invoke<MyPullRequestPage>("bitbucket_my_pull_requests", {
    request: { start, limit },
  });

export const refreshMyPullRequests = (start = 0, limit = 100) =>
  invoke<MyPullRequestPage>("bitbucket_my_pull_requests_refresh", {
    request: { start, limit },
  });

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

export const searchBitbucketUsers = (query: string) =>
  invoke<BitbucketUser[]>("bitbucket_search_users", { query });

export const searchBitbucketRepositories = (query: string) =>
  invoke<BitbucketRepository[]>("bitbucket_search_repositories", { query });

export const getPullRequestReviewSettings = () =>
  invoke<PullRequestReviewSettings>("pull_request_review_settings");

export const savePullRequestReviewSettings = (settings: PullRequestReviewSettings) =>
  invoke<PullRequestReviewSettings>("save_pull_request_review_settings", { settings });
