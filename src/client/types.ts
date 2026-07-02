export type SessionInfo = {
  id: string;
  path?: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
};

export type ModelInfo = {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
};

export type SourceInfo = {
  path?: string;
  source?: string;
  scope?: string;
  origin?: string;
};
export type ToolInfo = {
  name: string;
  description?: string;
  active: boolean;
  sourceInfo?: SourceInfo;
};
export type Theme = "system" | "dark" | "light";
export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};
export type AttachedImage = {
  data: string;
  mimeType: string;
  previewUrl: string;
};
