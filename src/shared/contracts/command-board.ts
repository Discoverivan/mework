export type CommandBoardColor =
  | "default"
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "purple"
  | "pink";

export interface CommandBoardItem {
  id: string;
  name: string;
  scriptPath: string;
  arguments: string;
  workingDirectory?: string | null;
  color?: CommandBoardColor;
}

export interface CommandBoardSaveRequest {
  id?: string;
  name: string;
  scriptPath: string;
  arguments: string;
  workingDirectory?: string;
  color?: CommandBoardColor;
}

export interface CommandBoardRunStatus {
  id: string;
  started: boolean;
}
