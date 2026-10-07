export type RetentionUnit = "minutes" | "hours" | "days" | "months";

export interface RetentionPeriod {
  value: number;
  unit: RetentionUnit;
}

export interface DataRetentionSettings {
  reviewHistory: RetentionPeriod;
  syncHistory: RetentionPeriod;
  removedTasks: RetentionPeriod;
  diagnosticLogs: RetentionPeriod;
}
