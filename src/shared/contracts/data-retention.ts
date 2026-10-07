export type RetentionUnit = "minutes" | "hours" | "days" | "months";

export type RetentionMode = "disabled" | "period" | "indefinite";

export interface RetentionPeriod {
  mode: RetentionMode;
  value: number;
  unit: RetentionUnit;
}

export interface DataRetentionSettings {
  reviewHistory: RetentionPeriod;
  syncHistory: RetentionPeriod;
  removedTasks: RetentionPeriod;
  diagnosticLogs: RetentionPeriod;
  diagnosticLogMaxMiB: number | null;
}
