"use client";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import type { TaskKind } from "@/domain";
import { groupSkills, skillSectionLabel } from "./skill-groups";
import { useEffect, useState } from "react";
import type { AgentKey, PromptApi } from "@/domain/agent-config";
import {
  defaultSkillFields,
  type SkillEntry,
  type SkillDetail,
  type SkillFields,
  type SkillLoad,
} from "@/domain/skills";
import { ChatMarkdown } from "@/shared/ui/chat-markdown";
import { StudioDialog } from "@/shared/ui/dialog";

export function SkillLoads({ loads }: { loads: SkillLoad[] }) {
  return (
    <section className="studio-prompt-rules">
      <h3>本轮实际读取的技能</h3>
      {!loads.length && (
        <p className="studio-muted">
          此轮没有技能读取记录；目录展示不代表已加载。
        </p>
      )}
      {loads.map((load) => (
        <details key={load.id + load.section}>
          <summary>
            {load.title} · {load.mode === "review" ? "审核" : "制作"} ·{" "}
            {load.section}
          </summary>
          <p className="studio-muted">
            系统 {load.version} · 自定义 v{load.customRevision} ·{" "}
            {new Date(load.loadedAt).toLocaleString("zh-CN")}
          </p>
          <p>用途：{load.reason}</p>
          <ChatMarkdown text={load.body} />
        </details>
      ))}
    </section>
  );
}
export function SkillSettings({
  projectId,
  agentKey,
  api,
  kinds,
}: {
  kinds?: TaskKind[];
  projectId: string;
  agentKey: AgentKey;
  api: PromptApi;
}) {
  const [items, setItems] = useState<SkillEntry[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const kindKey = kinds?.join(",") ?? "";
  const [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    (agentKey === "reviewer" && kindKey
      ? Promise.all(
          kindKey
            .split(",")
            .map((kind) => api.skills(projectId, agentKey, kind)),
        ).then((groups) => [
          ...new Map(groups.flat().map((item) => [item.id, item])).values(),
        ])
      : api.skills(projectId, agentKey)
    )
      .then((value) => {
        if (alive) setItems(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, projectId, agentKey, kindKey, refresh]);
  return (
    <section>
      <p className="studio-muted">
        只列此角色可用的技能，按用途分类。AI
        按任务选用，并非每轮全部加载；参考章节包含在技能内。
      </p>
      {error && (
        <p role="alert" className="studio-notice warning">
          {error}
        </p>
      )}
      {loading ? (
        <p>正在读取技能…</p>
      ) : !items.length ? (
        <p>此角色暂无适用的按需技能。</p>
      ) : (
        <>
          <div className="studio-skill-overview">
            <strong>{items.length} 个技能</strong>
            <span>{items.filter((i) => i.enabled).length} 个按需启用</span>
            <span>{groupSkills(items).length} 个分类</span>
          </div>
          {items.length > 3 && (
            <label className="studio-organize-search">
              <Search size={17} />
              <input
                aria-label="查找技能"
                placeholder="查找方法，如分集、人物、布光"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          <div className="studio-skill-groups">
            {groupSkills(items, query).map((group) => (
              <details
                className="studio-member-stage"
                key={group.title + query}
                open={items.length <= 3 || !!query}
              >
                <summary>
                  <span>
                    <strong>{group.title}</strong>
                    <small>{group.note}</small>
                  </span>
                  <small>{group.items.length} 个技能</small>
                  <ChevronDown size={16} />
                </summary>
                <div className="studio-agent-list studio-member-stage-body">
                  {group.items.map((item) => (
                    <button key={item.id} onClick={() => setSelected(item.id)}>
                      <span>
                        <strong>{item.title}</strong>
                        <small className="studio-skill-description">
                          {item.description}
                        </small>
                      </span>
                      <small
                        className={`studio-skill-state ${item.enabled ? "" : "disabled"}`}
                      >
                        {item.enabled ? "按需" : "停用"}
                        {item.customRevision > 0 ? " · 已自定义" : ""}
                      </small>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              </details>
            ))}
          </div>
          {!groupSkills(items, query).length && (
            <p className="studio-muted">没有匹配的技能。</p>
          )}
        </>
      )}

      {selected && (
        <SkillEditor
          key={selected}
          projectId={projectId}
          id={selected}
          api={api}
          onSaved={() => setRefresh((n) => n + 1)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
function SkillEditor({
  projectId,
  id,
  api,
  onSaved,
  onClose,
}: {
  projectId: string;
  id: string;
  api: PromptApi;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null),
    [fields, setFields] = useState(defaultSkillFields);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"methods" | "custom" | "history">("methods");
  const [history, setHistory] = useState<{
    revision: number;
    fields: SkillFields;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .skill(projectId, id)
      .then((value) => {
        if (alive) {
          setDetail(value);
          setFields(value.fields);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [api, projectId, id]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <StudioDialog title={detail?.title ?? "技能设置"} onClose={onClose} wide>
      {error && (
        <p role="alert" className="studio-notice warning">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="studio-notice">
          {notice}
        </p>
      )}
      {!detail ? (
        <p>正在读取…</p>
      ) : (
        <>
          <p>{detail.description}</p>
          <p className="studio-muted">
            系统版本 {detail.version} · 自定义 v{detail.customRevision}
            。系统方法只读，补充不能改变工具权限和已确认需求。
          </p>
          <nav
            className="studio-detail-tabs studio-agent-tabs"
            aria-label="技能设置栏目"
          >
            {(
              [
                ["methods", "方法与参考"],
                ["custom", "本剧本补充"],
                ["history", "版本记录"],
              ] as const
            ).map(([id, title]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {title}
              </button>
            ))}
          </nav>
          {tab === "methods" && (
            <div className="studio-prompt-rules">
              {Object.entries(detail.resources).map(([name, body]) => (
                <details key={name}>
                  <summary>
                    {skillSectionLabel(name, body)}
                    {name.startsWith("references/") ? " · 参考" : " · 系统"}
                  </summary>
                  <ChatMarkdown text={body} />
                </details>
              ))}
            </div>
          )}
          {tab === "custom" && (
            <section className="studio-prompt-editor">
              <h3>本剧本自定义</h3>
              <p className="studio-muted">
                补充会影响本剧本所有使用此技能的
                AI；制作与审核要求分别填写，保存后下一轮生效。
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={fields.enabled}
                  disabled={busy}
                  onChange={(e) =>
                    setFields({ ...fields, enabled: e.target.checked })
                  }
                />{" "}
                允许 AI 按需使用此技能
              </label>
              <label className="studio-field">
                制作补充
                <textarea
                  aria-label="技能制作补充"
                  rows={5}
                  maxLength={8000}
                  value={fields.instructions}
                  disabled={busy}
                  onChange={(e) =>
                    setFields({ ...fields, instructions: e.target.value })
                  }
                  placeholder="适用条件、内容偏好、正反例；留空沿用系统方法"
                />
              </label>
              <label className="studio-field">
                审核补充
                <textarea
                  aria-label="技能审核补充"
                  rows={4}
                  maxLength={8000}
                  value={fields.review}
                  disabled={busy}
                  onChange={(e) =>
                    setFields({ ...fields, review: e.target.value })
                  }
                  placeholder="仅填写此剧本需要额外核对的内容"
                />
              </label>
              <div className="studio-actions">
                <button
                  disabled={
                    busy ||
                    JSON.stringify(fields) === JSON.stringify(detail.fields)
                  }
                  onClick={() =>
                    perform(async () => {
                      const saved = await api.saveSkill(
                        projectId,
                        id,
                        detail.customRevision,
                        fields,
                      );
                      setDetail(saved);
                      setFields(saved.fields);
                      onSaved();
                      setNotice("已保存，下次执行生效。");
                    })
                  }
                >
                  保存技能设置
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setFields(defaultSkillFields());
                    setNotice("已载入默认值，保存后生效。");
                  }}
                >
                  恢复默认到编辑区
                </button>
              </div>
            </section>
          )}
          {tab === "history" && (
            <section className="studio-prompt-history">
              <h3>自定义版本历史</h3>
              {!detail.versions.length && <p>尚无自定义版本。</p>}
              {detail.versions.map((version) => (
                <button
                  key={version.revision}
                  disabled={busy}
                  onClick={() =>
                    perform(async () =>
                      setHistory(
                        await api.skillVersion(projectId, id, version.revision),
                      ),
                    )
                  }
                >
                  v{version.revision} ·{" "}
                  {new Date(version.createdAt).toLocaleString("zh-CN")}
                </button>
              ))}
            </section>
          )}
          {tab === "history" && history && (
            <section>
              <h3>历史 v{history.revision}</h3>
              <p>{history.fields.enabled ? "启用" : "停用"}</p>
              <h4>制作补充</h4>
              <ChatMarkdown text={history.fields.instructions || "未设置"} />
              <h4>审核补充</h4>
              <ChatMarkdown text={history.fields.review || "未设置"} />
              <button
                disabled={busy}
                onClick={() => {
                  setFields(history.fields);
                  setHistory(null);
                  setTab("custom");
                  setNotice("已载入历史内容，保存会产生新版本。");
                }}
              >
                载入历史到编辑区
              </button>
            </section>
          )}
        </>
      )}
    </StudioDialog>
  );
}
