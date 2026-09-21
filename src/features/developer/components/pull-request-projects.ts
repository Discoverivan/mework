import type { MyPullRequest } from "@/shared/contracts/developer";

export interface PullRequestProjectGroup {
  key: string;
  projectKey: string;
  pullRequests: MyPullRequest[];
}

export function groupPullRequestsByProject(values: MyPullRequest[]): PullRequestProjectGroup[] {
  const groups = new Map<string, PullRequestProjectGroup>();
  values.forEach((pullRequest) => {
    const key = `${pullRequest.integrationId}:${pullRequest.projectKey}`;
    const existing = groups.get(key);
    if (existing) {
      existing.pullRequests.push(pullRequest);
      return;
    }
    groups.set(key, {
      key,
      projectKey: pullRequest.projectKey,
      pullRequests: [pullRequest],
    });
  });
  return [...groups.values()];
}
