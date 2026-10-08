import type { MyPullRequest } from "@/shared/contracts/developer";

export interface PullRequestProjectGroup {
  key: string;
  label: string;
  pullRequests: MyPullRequest[];
}

export type PullRequestSortOrder = "newest" | "oldest";

export function sortPullRequestsByUpdatedDate(
  values: MyPullRequest[],
  order: PullRequestSortOrder,
): MyPullRequest[] {
  const direction = order === "newest" ? -1 : 1;
  return [...values].sort((left, right) => {
    if (left.updatedDate == null) return right.updatedDate == null ? 0 : 1;
    if (right.updatedDate == null) return -1;
    return direction * (left.updatedDate - right.updatedDate)
      || left.pullRequestId.localeCompare(right.pullRequestId);
  });
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
      label: pullRequest.projectKey,
      pullRequests: [pullRequest],
    });
  });
  return [...groups.values()];
}

export function groupPullRequestsByPerson(values: MyPullRequest[]): PullRequestProjectGroup[] {
  const groups = new Map<string, PullRequestProjectGroup>();
  values.forEach((pullRequest) => {
    const label = pullRequest.authorDisplayName.trim();
    const key = `${pullRequest.integrationId}:${label}`;
    const existing = groups.get(key);
    if (existing) existing.pullRequests.push(pullRequest);
    else groups.set(key, { key, label, pullRequests: [pullRequest] });
  });
  return [...groups.values()];
}
