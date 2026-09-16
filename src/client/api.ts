export type RecordData = Record<string, unknown>;
export interface Workspace {
  preparation?: RecordData | null;
  preparationRecords?: RecordData[];
  aiRelations?: RecordData[];
  groupCandidates?: RecordData[];
  overview: {
    project: RecordData;
    workflow: RecordData | null;
    stages: RecordData[];
    counts: { assets: number; approved: number; items: number };
    blockers: RecordData[];
    pendingReviews: RecordData[];
  };
  documents: RecordData[];
  stories: RecordData[];
  workflows: RecordData[];
  sections: RecordData[];
  seasons: RecordData[];
  nodes: RecordData[];
  dependencies: RecordData[];
  agents: RecordData[];
  sessions: RecordData[];
  messages: RecordData[];
  highlights: RecordData[];
  items: RecordData[];
  assets: RecordData[];
  approvedVersions: RecordData[];
  runs: RecordData[];
  skills: RecordData[];
  audit: RecordData[];
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "请求失败");
  return result.data as T;
}
export const str = (row: RecordData, key: string) => String(row[key] ?? "");
export const list = (value: unknown) =>
  Array.isArray(value) ? (value as RecordData[]) : [];
export const labels: Record<string, string> = {
  open: "可接续",
  closed: "已结束",
  planned: "待准备",
  active: "进行中",
  draft: "草案",
  archived: "已归档",
  ready: "就绪",
  running: "执行中",
  blocked: "待处理",
  review: "待审核",
  completed: "已完成",
  cancelled: "已取消",
  candidate: "候选",
  approved: "已定稿",
  rejected: "已退回",
  proposed: "待确认",
  confirmed: "已确认",
  changes_requested: "需调整",
  reference: "共用资料",
  superseded: "已替代",
  coordinator: "总控",
  work: "专业节点",
  goal: "目标",
  decision: "结论",
  question: "待解决",
  next_step: "下一步",
  character: "人物",
  costume: "服装",
  prop: "道具",
  scene: "场景",
  composite: "组合",
  document: "文稿",
  image: "图片",
  audio: "音频",
  video: "视频",
};
