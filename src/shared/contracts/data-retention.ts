export type RetentionUnit = "minutes" | "hours" | "days" | "months";

export type RetentionMode = "disabled" | "period" | "indefinite";

export interface RetentionPeriod {
  mode: RetentionMode;
  value: number;
  unit: RetentionUnit;
}

export type LogSizeUnit = "kib" | "mib" | "gib";

export interface LogSizeLimit {
  value: number;
  unit: LogSizeUnit;
}

export interface DataRetentionSettings {
  reviewHistory: RetentionPeriod;
  syncHistory: RetentionPeriod;
  removedTasks: RetentionPeriod;
  diagnosticLogs: RetentionPeriod;
  diagnosticLogSizeLimit: LogSizeLimit | null;
}
