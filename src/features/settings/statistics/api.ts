import { invoke } from "@tauri-apps/api/core";

export type AiUsagePeriod = "today" | "seven_days" | "month";

export interface AiUsageBucket {
  date: string;
  providerId: string;
  providerName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiUsageModelTotal {
  providerId: string;
  providerName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiUsageTotal {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiUsageStatistics {
  period: AiUsagePeriod;
  daily: AiUsageBucket[];
  byModel: AiUsageModelTotal[];
  total: AiUsageTotal;
}

export const getAiUsageStatistics = (period: AiUsagePeriod) =>
  invoke<AiUsageStatistics>("ai_usage_statistics", { period });
