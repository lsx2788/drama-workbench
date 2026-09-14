"use client";
import { str, type Workspace } from "@/client/api";
import { Empty, Panel, date } from "./ui";
import type { CreateAction } from "./view-types";
export function DocumentsView({
  w,
  create,
}: {
  w: Workspace;
  create: CreateAction;
}) {
  return (
    <>
      <div className="section-actions">
        <div>
          <h2>故事与文稿</h2>
          <p>大纲、剧本和制作笔记独立保存，修订保留原文。</p>
        </div>
        <button className="primary" onClick={() => create("document")}>
          ＋ 保存文稿
        </button>
      </div>
      {w.documents.length ? (
        w.documents.map((d) => (
          <Panel
            key={str(d, "id")}
            title={str(d, "title")}
            action={
              <button
                onClick={() =>
                  create("document", {
                    title: str(d, "title"),
                    kind: str(d, "kind"),
                    content: str(d, "content"),
                    supersedesId: str(d, "id"),
                  })
                }
              >
                创建修订
              </button>
            }
          >
            <small className="muted">
              修订 {str(d, "revision")} · {date(d.created_at)}
            </small>
            <p className="pre">{str(d, "content")}</p>
            <small className="mono">{str(d, "id")}</small>
          </Panel>
        ))
      ) : (
        <Empty>故事从这里开始。保存一份大纲，再和总控讨论下一步。</Empty>
      )}
    </>
  );
}
