import { APP_EVENT, subscribeAppEvent } from "@/app/app-events";
import type { TeamMember } from "@/shared/contracts/planning";

// Native updates contain the saved local state. Consumers never repeat Jira reads.
// This memory cache starts empty; command reads still revalidate on page entry.
const membersByProject = new Map<string, TeamMember[]>();

subscribeAppEvent(APP_EVENT.teamMembersChanged, ({ managedProjectId, members }) => {
  membersByProject.set(managedProjectId, members);
});

export function readUpdatedTeamMembers(projectId: string): TeamMember[] | undefined {
  return membersByProject.get(projectId);
}

export function clearTeamMembersStateForTests(): void {
  membersByProject.clear();
}
