import type { TeamMember } from "./planning";

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

export interface PullRequestReviewState {
  runId: string;
  status: PullRequestReviewStatus;
  reviewedCommit: string | null;
  result: PullRequestReviewResult | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface PullRequestReviewChangedEvent {
  key: string;
  review: PullRequestReviewState;
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

export interface MyPullRequestPage {
  values: MyPullRequest[];
  total?: number;
  nextStart?: number;
  hasMore: boolean;
  lastUpdatedAt?: number;
}
