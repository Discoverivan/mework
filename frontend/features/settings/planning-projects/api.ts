import { invoke } from "@tauri-apps/api/core";
import type {
  JiraProjectValidation,
  JiraProjectValidationInput,
  ManagedProjectSaveInput,
  ManagedProjectSettings,
} from "@/shared/contracts/settings";

export const listManagedProjects = (integrationId?: string) =>
  invoke<ManagedProjectSettings[]>("managed_project_list", integrationId ? { integrationId } : {});

export const saveManagedProject = (request: ManagedProjectSaveInput) =>
  invoke<ManagedProjectSettings>("managed_project_save", { request });

export const validateJiraProjectKey = (request: JiraProjectValidationInput) =>
  invoke<JiraProjectValidation>("planning_project_validate", { request });

export const deleteManagedProject = (id: string) =>
  invoke<void>("managed_project_delete", { id });
