export type AiProviderId = "codex-cli";
export type AiProviderStatus = "loading" | "connected" | "not_found" | "not_authenticated" | "unavailable";
export type AiReasoning = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AiSettings {
  provider: AiProviderId | null;
  model: string;
  reasoning: AiReasoning;
  fastMode: boolean;
}

export interface AiProvider {
  id: AiProviderId;
  name: string;
  status: AiProviderStatus;
  available: boolean;
  models: string[];
  executablePath?: string;
  version?: string;
  message?: string;
}

export interface AiSettingsPageData {
  settings: AiSettings;
  providers: AiProvider[];
}

export type IntegrationKind = "jira" | "bitbucket";
export type IntegrationHealthStatus = "unknown" | "working" | "unavailable";

export interface IntegrationRedacted {
  id: string;
  kind: IntegrationKind;
  baseUrl: string;
  accountKey?: string;
  enabled: boolean;
  allowInsecureTls?: boolean;
  credentialRef?: string;
  accountDisplayName?: string;
  healthStatus?: IntegrationHealthStatus;
  healthError?: string;
  healthDetails?: string;
  healthCheckedAt?: string;
  capabilities: unknown;
  lastSuccessAt?: string;
}

export interface IntegrationHealth {
  status: IntegrationHealthStatus;
  message?: string;
  details?: string;
}

export interface IntegrationSaveInput {
  id?: string;
  kind: IntegrationKind;
  baseUrl: string;
  accountKey?: string;
  secret?: string;
  enabled?: boolean;
  allowInsecureTls?: boolean;
  allowUnavailable?: boolean;
}

export type IntegrationSaveResult =
  | { status: "saved"; integration: IntegrationRedacted }
  | { status: "requiresConfirmation"; health: IntegrationHealth };

export interface IntegrationDeleteInput {
  id: string;
}

export interface IntegrationHealthCheckInput {
  id: string;
}

export interface IntegrationSetEnabledInput {
  id: string;
  enabled: boolean;
}

/** Redacted DTO returned by the managed_project_list command. */
export interface ManagedProjectSettings {
  id: string;
  integrationId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  boardId?: string;
  sourceSprintId?: string;
  sourceSprintName?: string;
  storyPointsFieldId?: string;
  competencyFieldId?: string;
  subtaskIssueTypeId?: string;
  defaultTeamPresetId?: string;
  defaultTaskSprintId?: string;
  defaultTaskSprintName?: string;
  defaultEpicLinkKey?: string;
  defaultEpicLinkSummary?: string;
  epicLinkJql: string;
  enabled: boolean;
  lastMetadataRefreshAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ManagedProjectSaveInput {
  id?: string;
  integrationId: string;
  jiraProjectId: string;
  jiraProjectKey: string;
  jiraProjectName: string;
  boardId?: string;
  sourceSprintId?: string;
  sourceSprintName?: string;
  storyPointsFieldId?: string;
  competencyFieldId?: string;
  subtaskIssueTypeId?: string;
  defaultTeamPresetId?: string;
  defaultTaskSprintId?: string;
  defaultTaskSprintName?: string;
  defaultEpicLinkKey?: string;
  defaultEpicLinkSummary?: string;
  epicLinkJql?: string;
  enabled: boolean;
}

export interface JiraProjectValidation {
  projectId: string;
  projectKey: string;
  projectName: string;
}

export interface JiraProjectValidationInput {
  integrationId: string;
  projectKey: string;
}

export interface JiraProjectOption {
  id: string;
  key: string;
  name: string;
}

export interface JiraBoardOption {
  id: string;
  name: string;
}

export interface JiraSprintOption {
  id: string;
  name: string;
  state: "future" | "active" | "closed" | "unknown";
}

export interface JiraFieldOption {
  id: string;
  name: string;
}

export interface JiraIssueTypeOption {
  id: string;
  name: string;
  subtask: boolean;
}

export interface ManagedProjectDiscovery {
  availability: "available" | "unavailable";
  reason?: string;
  projects: JiraProjectOption[];
  boards: JiraBoardOption[];
  sourceSprints: JiraSprintOption[];
  fields: JiraFieldOption[];
  issueTypes: JiraIssueTypeOption[];
}
