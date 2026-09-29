import type { MyPullRequestPage } from "./developer";
import type { TaskTrackerMonitor } from "./task-tracker";

export interface DevOverlaySnapshot {
  monitors: TaskTrackerMonitor[];
  parentIssues: { key: string; summary: string }[];
  assignees: { id: string; displayName: string }[];
  sprints: { id: string; name: string; state: string }[];
  reviewerPullRequests: MyPullRequestPage;
  authoredPullRequests: MyPullRequestPage;
}
