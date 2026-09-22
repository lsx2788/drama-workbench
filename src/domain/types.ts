import type { OutputStructure } from "./expansion";
export type TaskKind =
  | "source"
  | "brief"
  | "script"
  | "episode"
  | "storyboard"
  | "board"
  | "assets"
  | "frames"
  | "video"
  | "assembly";
export type Delivery = "empty" | "draft" | "reviewed" | "approved" | "returned";
export type Task = {
  id: string;
  kind: TaskKind;
  title: string;
  objective: string;
  episode?: number;
  shot?: number;
  dependencies: string[];
  enabled: boolean;
  reviewEnabled: boolean;
  placeholder?: boolean;
  delivery: Delivery;
  text: string;
  structure?: OutputStructure;
  rejection?: string;
  revision: number;
  history: { text: string; revision: number; delivery: Delivery }[];
  assetIds: string[];
  reuseReason: string;
  assetName?: string;
  assetCategory?: "人物" | "场景" | "道具";
  imageSpec?: { purpose: string; basisTaskId?: string };
  retirement?: { reason: string; actor: string; time: string };
};
export type Episode = {
  number: number;
  title: string;
  synopsis: string;
  shots: number;
  representativeShot?: number;
};
export type Asset = {
  id: string;
  name: string;
  category: "人物" | "场景" | "道具" | "镜头画面";
  status: "approved" | "draft";
  description: string;
  version: number;
  sourceIds: string[];
  taskId?: string;
  outputRevision?: number;
  files?: MediaFile[];
};
export type Message = {
  id: string;
  sender: string;
  text: string;
  taskId?: string;
  time: string;
  audience?: "human" | "agents";
  phase?: string;
  runId?: string;
  replyToId?: string;
  references?: TaskReference[];
  attachments?: MediaFile[];
  questionTransfer?: { questionId: string; status: "pending" | "answered" };
  feedback?: { status: string; taskId: string; revision: number };
  execution?: { status: string; error?: string };
  image?: {
    id: string;
    status: "generating" | "completed" | "failed";
    name: string;
    error?: string;
    revision?: number;
    file?: MediaFile;
    current: boolean;
    delivery?: Delivery;
  };
  confirmation?: {
    status: "pending" | "answered" | "skipped";
    answeredBy?: string;
    skippedAt?: string;
  };
};
export type TaskReference = {
  file: MediaFile;
  purpose: string;
  offset: number;
  limit: number;
  source: "original" | "output";
  sourceTaskId?: string;
  sourceRevision?: number;
};
export type TaskEvent = {
  id: string;
  taskId: string;
  action: string;
  revision: number;
  text: string;
  time: string;
};
export type Source = {
  id: string;
  name: string;
  text?: string;
  size: number;
  type: string;
};
export type StudioProject = {
  imageLibrary?: LibraryImage[];
  version?: number;
  run?: { id: string; status: string; error?: string; progress?: string };
  plan?: {
    id: string;
    summary: string;
    episodes?: Episode[];
    representativeEpisode?: number;
    representativeShot?: number;
    confirmed: boolean;
  };
  sessions?: { role: string; scope: string; threadId?: string }[];
  id: string;
  name: string;
  confirmed: boolean;
  representativeEpisode: number;
  representativeShot: number;
  episodes: Episode[];
  tasks: Record<string, Task>;
  assets: Asset[];
  messages: Message[];
  events: TaskEvent[];
  sources: Source[];
};
export type StudioState = {
  schema: 1;
  projects: StudioProject[];
  activeId: string;
};
export type MediaFile = {
  width?: number;
  height?: number;
  trashed?: boolean;
  id?: string;
  name: string;
  url: string;
  size: number;
  type: string;
};
export type LibraryImage = {
  file: MediaFile;
  taskId: string;
  name: string;
  revision: number;
  current: boolean;
  createdAt: string;
  rulesVersion?: string;
  trash?: { reason: string; actor: string; time: string };
};
