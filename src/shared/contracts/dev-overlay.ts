import type { MyPullRequestPage } from "./developer";
import type { TaskTrackerMonitor } from "./task-tracker";

export interface DevOverlaySnapshot {
  monitors: TaskTrackerMonitor[];
  reviewerPullRequests: MyPullRequestPage;
  authoredPullRequests: MyPullRequestPage;
}
