export type UpdateCheckStatus = "idle" | "checking" | "current" | "available" | "error";

export interface UpdateAvailabilitySnapshot {
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
  availableVersion: null,
  lastCheckedAt: null,
  status: "idle",
  revision: 0,
};
