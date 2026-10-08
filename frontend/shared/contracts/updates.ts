export type UpdateCheckStatus = "idle" | "checking" | "current" | "available" | "error";

export interface UpdateAvailabilitySnapshot {
  checkSource: "background" | "manual";
  availableVersion: string | null;
  lastCheckedAt: number | null;
  status: UpdateCheckStatus;
  revision: number;
}

export interface UpdateCheckTicket {
  checkId: number;
  snapshot: UpdateAvailabilitySnapshot;
}

export interface UpdateCheckCompletion {
  accepted: boolean;
  snapshot: UpdateAvailabilitySnapshot;
}

export const EMPTY_UPDATE_AVAILABILITY: UpdateAvailabilitySnapshot = {
  checkSource: "background",
  availableVersion: null,
  lastCheckedAt: null,
  status: "idle",
  revision: 0,
};
