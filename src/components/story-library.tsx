"use client";
import { useState, useMemo, useEffect } from "react";
import {
  api,
  str,
  list,
  labels,
  type Workspace,
  type RecordData,
} from "@/client/api";
import { storyRecords, type StoryRecord } from "@/client/story-records";
import { Badge, Dialog, Empty, Panel, date } from "./ui";
import { AssetFile } from "./asset-file";
const attributeLabels: Record<string, string> = {
  age: "年龄",
  gender: "性别",
  costume: "服装",
  era: "时代",
  appearance: "外貌",
  personality: "性格",
  purpose: "用途",
  scene: "适用场景",
  episode: "集数",
  stage: "阶段",
  format: "内容格式",
  demo: "演示资料",
  nodeId: "来源节点",
  entityKey: "对象标识",
};
function AssetRecord({
  record,
  p,
  w,
}: {
  record: StoryRecord;
  p: string;
  w: Workspace;
}) {
  const [detail, setDetail] = useState<RecordData>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<RecordData>(`/projects/${p}/assets/${record.id}`)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [record.id, p]);
  const attrs = JSON.parse(str(record.source, "attributes_json") || "{}");
  return (
    <>
      <p>{record.description}</p>
      <dl className="record-fields">
        <dt>资产编号</dt>
        <dd>{record.code}</dd>
        <dt>资产类型</dt>
        <dd>{labels[str(record.source, "kind")]}</dd>
        <dt>对象标识</dt>
        <dd>{str(record.source, "entity_key") || "—"}</dd>
        {Object.entries(attrs).map(([k, v]) => (
          <div className="record-field" key={k}>
            <dt>{attributeLabels[k] ?? k}</dt>
            <dd>
              {k === "nodeId"
                ? str(w.nodes.find((n) => n.id === v) ?? {}, "name")
                : typeof v === "boolean"
                  ? v
                    ? "是"
                    : "否"
                  : String(v)}
            </dd>
          </div>
        ))}
      </dl>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!detail && !error && <p className="muted">正在读取文件与版本…</p>}
      {detail &&
        list(detail.versions).map((v) => (
          <Panel
            key={str(v, "id")}
            title={`版本 ${v.version}`}
            action={<Badge value={str(v, "status")} />}
          >
            <p>{str(v, "notes")}</p>
            <p className="muted">
              批准范围：{str(v, "approval_scope") || "尚未批准"}
            </p>
            {list(v.sources).length > 0 && (
              <p>
                来源：
                {list(v.sources)
                  .map((s) => `${s.code} · ${s.name} v${s.version}`)
                  .join("、")}
              </p>
            )}
            {list(v.files).map((f) => (
              <AssetFile key={str(f, "id")} file={f} />
            ))}
            {!list(v.files).length && (
              <p className="muted">仅有需求记录，尚未归档实际文件。</p>
            )}
          </Panel>
        ))}
    </>
  );
}
export function StoryLibrary({ w, p }: { w: Workspace; p: string }) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部"),
    [selected, setSelected] = useState<StoryRecord | null>(null);
  const records = useMemo(() => storyRecords(w), [w]);
  const categories = ["全部", ...new Set(records.map((r) => r.category))];
  const matches = records.filter(
    (r) =>
      (category === "全部" || r.category === category) &&
      `${r.code} ${r.name} ${r.description} ${r.content} ${r.node} ${JSON.stringify(r.source)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="section-actions">
        <div>
          <h2>故事资产库</h2>
          <p>故事设定、文稿、素材、决策与制作记录，统一查询。</p>
        </div>
        <span className="muted">{records.length} 条记录</span>
      </div>
      <div className="library-toolbar">
        <input
          aria-label="搜索故事资料"
          placeholder="搜索名称、编号、年龄、情节或内容…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="资料分类"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {matches.length ? (
        <div className="library-table-wrap">
          <table className="library-table">
            <thead>
              <tr>
                <th>编号 / 名称</th>
                <th>分类</th>
                <th>状态</th>
                <th>关联节点</th>
                <th>内容说明</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((r) => (
                <tr key={`${r.type}:${r.id}`}>
                  <td>
                    <button
                      className="record-link"
                      onClick={() => setSelected(r)}
                    >
                      {r.name}
                    </button>
                    <small>{r.code}</small>
                  </td>
                  <td>{r.category}</td>
                  <td>{r.status ? <Badge value={r.status} /> : "已保存"}</td>
                  <td>{r.node || "项目共用"}</td>
                  <td>
                    <span className="record-summary">
                      {r.description || "点击查看完整记录"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>没有匹配的记录。</Empty>
      )}
      {selected && (
        <Dialog title={selected.name} onClose={() => setSelected(null)}>
          {selected.type === "asset" ? (
            <AssetRecord record={selected} p={p} w={w} />
          ) : (
            <>
              <p className="muted">
                {selected.category} · {selected.node || "项目共用"}
              </p>
              {selected.status && <Badge value={selected.status} />}
              <p className="pre">{selected.content}</p>
              <p className="pre">
                {selected.description !== selected.content
                  ? selected.description
                  : ""}
              </p>
              {selected.type === "session" && (
                <>
                  <p>
                    外部会话标识：
                    {str(selected.source, "external_session_id") || "尚未绑定"}
                  </p>
                  {w.messages
                    .filter((m) => m.session_id === selected.id)
                    .map((m) => (
                      <article className="message" key={str(m, "id")}>
                        <small>
                          {m.sender_type === "human"
                            ? "用户"
                            : str(m, "agent_name")}{" "}
                          · {date(m.created_at)}
                        </small>
                        <p className="pre">{str(m, "content")}</p>
                      </article>
                    ))}
                  {!w.messages.some((m) => m.session_id === selected.id) && (
                    <p className="muted">会话已登记，尚无实际消息。</p>
                  )}
                </>
              )}
              {selected.type === "item" && (
                <p>交付要求：{str(selected.source, "acceptance")}</p>
              )}
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
