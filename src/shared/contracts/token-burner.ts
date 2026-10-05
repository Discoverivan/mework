export type TokenBurnerStatus =
  | "idle"
  | "running"
  | "paused"
  | "stopping"
  | "target_reached"
  | "no_prs"
  | "error"
  | "interrupted";

export type TokenBurnerIterationStatus = "waiting" | "running" | "completed" | "failed";

export interface TokenBurnerSettings {
  dailyTarget: number;
  delayBetweenRequestsSeconds: number;
  repository: string | null;
}

export interface TokenBurnerRepository {
  key: string;
  name: string;
}

export interface TokenBurnerIteration {
  id: string;
  pullRequestId: string;
  pullRequestTitle: string;
  repositoryName: string;
  repositoryKey: string;
  url?: string;
  perspective: string;
  status: TokenBurnerIterationStatus;
  phase: string;
  totalTokens: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface TokenBurnerSnapshot {
  settings: TokenBurnerSettings;
  status: TokenBurnerStatus;
  tokensUsedToday: number;
  activeForMs: number;
  sessionStartedAt?: number;
  previousSessionInterrupted: boolean;
  error?: string;
  activeIterations: TokenBurnerIteration[];
  completedIterations: TokenBurnerIteration[];
}
