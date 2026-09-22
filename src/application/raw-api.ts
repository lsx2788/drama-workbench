export type RawSession = {
  id: string;
  scope: string;
  role: string;
  title?: string;
  threadId?: string;
  count: number;
};
export type RawEvent = {
  seq: number;
  kind: string;
  sender: string;
  recipient: string;
  body: string;
  revision?: number;
  created_at: string;
  thread_id?: string;
  turn_id?: string;
  run_id: string;
};
export async function readRaw(
  projectId: string,
  sessionId?: string,
  before?: number,
): Promise<{
  sessions?: RawSession[];
  events?: RawEvent[];
  before?: number | null;
}> {
  const query = new URLSearchParams({ raw: projectId });
  if (sessionId) query.set("session", sessionId);
  if (before) query.set("before", String(before));
  const response = await fetch(`/api/studio?${query}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
