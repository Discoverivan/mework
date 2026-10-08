import type { TeamMember } from "./planning";
import type { AiProviderId, AiReasoning } from "./settings";

export interface DailyIssueTransition {
  id: string;
  name: string;
  toStatus: string;
  requiresFields: boolean;
}

export interface DailySubtask {
  id: string;
  key: string;
  summary: string;
  status: string;
  storyPoints?: number;
  statusTransitionAt?: string;
  assigneeAccountId?: string;
  assigneeDisplayName?: string;
  issueType: string;
  parentIssueKey?: string;
  url: string;
  parentUrl?: string;
}

export interface DailySprint {
  id: string;
  name: string;
  state: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface DailyWorkspace {
  managedProjectId: string;
  projectName: string;
  projectKey: string;
  selectedSprintId: string;
  selectedSprintName: string;
  sprintBoardUrl: string;
  sprintBoardUrlsByAssignee: Record<string, string>;
  sprints: DailySprint[];
  members: TeamMember[];
  subtasks: DailySubtask[];
}

export interface DailyPresenterState {
  workspace: DailyWorkspace;
  selectedMemberId: string;
}

export interface BitbucketProject {
  integrationId: string;
  projectKey: string;
  projectName: string;
}

export interface BitbucketRepository {
  projectKey: string;
  projectName: string;
  repositorySlug: string;
  repositoryName: string;
}

export interface BitbucketUser {
  name?: string;
  displayName?: string;
  slug?: string;
}

export interface PullRequestReviewSettings {
  filterMode: "allow" | "deny";
  projectBlacklist: string[];
  projectWhitelist: string[];
  repositoryBlacklist: string[];
  creatorBlacklist: string[];
  repositoryWhitelist: string[];
  creatorWhitelist: string[];
  autoReviewEnabled: boolean;
  authoredAutoReviewEnabled: boolean;
}

export type MyPullRequestDecision = "approved" | "needs_work" | "not_reviewed";

export type PullRequestReviewStatus = "running" | "completed" | "failed";
export type PullRequestReviewVerdict = "ok" | "needs_changes";
export type PullRequestReviewSeverity = "blocker" | "high" | "medium" | "low";

export interface PullRequestReviewComment {
  severity: PullRequestReviewSeverity;
  file: string;
  line: number | null;
  comment: string;
}

export interface PullRequestReviewResult {
  verdict: PullRequestReviewVerdict;
  description: string;
  summary: string;
  comments: PullRequestReviewComment[];
}

export interface PullRequestReviewExecution {
  instructionsHash?: string | null;
  provider: AiProviderId;
  providerName: string;
  providerInstanceId: string | null;
  model: string;
  reasoning: AiReasoning | null;
  mode: "normal" | "fast" | null;
}

export interface PullRequestReviewState {
  instructionsChanged?: boolean;
  runId: string;
  status: PullRequestReviewStatus;
  reviewedCommit: string | null;
  result: PullRequestReviewResult | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  execution?: PullRequestReviewExecution | null;
}

export interface PullRequestReviewChangedEvent {
  key: string;
  review: PullRequestReviewState;
}

export interface PullRequestCommentMatchesRequest extends PullRequestReviewStateRequest {
  comments: PullRequestReviewComment[];
}

export interface PullRequestPublishableComment extends PullRequestReviewComment {
  parentCommentId?: number;
}

export interface PullRequestCommentMatch {
  index: number;
  commentId: number;
  coverage: "full" | "partial";
  addition: string;
  parentCommentId?: number | null;
}

export interface PullRequestCommentMatches {
  matches: PullRequestCommentMatch[];
}

export interface PullRequestReviewStateRequest {
  integrationId: string;
  projectKey: string;
  repositorySlug: string;
  pullRequestId: string;
  latestCommit?: string;
}

export interface PullRequestReviewSummary {
  approved: number;
  needsWork: number;
  comments: number;
}

export interface MyPullRequest {
  integrationId: string;
  pullRequestId: string;
  title: string;
  state: string;
  repositorySlug: string;
  repositoryName: string;
  projectKey: string;
  sourceBranch: string;
  targetBranch: string;
  authorDisplayName: string;
  authorAvatarUrl?: string;
  updatedDate?: number;
  latestCommit?: string;
  url?: string;
  myDecision: MyPullRequestDecision;
  activity: "new" | "updated" | "read";
  reviewSummary?: PullRequestReviewSummary;
  needsAction?: boolean;
  review?: PullRequestReviewState;
}

export interface PullRequestUnreadCounts {
  reviewer: number;
  authored: number;
}

export interface PullRequestUnreadCountsRequest {
  reviewerPendingOnly: boolean;
  authoredNeedsActionOnly: boolean;
}

export interface MyPullRequestPage {
  values: MyPullRequest[];
  total?: number;
  nextStart?: number;
  hasMore: boolean;
  lastUpdatedAt?: number;
}
