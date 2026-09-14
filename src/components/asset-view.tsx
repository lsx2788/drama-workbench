"use client";
import { ReferencePicker } from "./reference-picker";
import { useState } from "react";
import {
  api,
  str,
  list,
  labels,
  type RecordData,
  type Workspace,
} from "@/client/api";
import { Badge, Dialog, Empty, Field } from "./ui";
export function AssetView({
  w,
  p,
  create,
  refresh,
  fail,
}: {
  w: Workspace;
  p: string;
  create: () => void;
  refresh: () => Promise<void>;
  fail: (e: unknown) => void;
}) {
  const [filter, setFilter] = useState(""),
    [kind, setKind] = useState(""),
    [detail, setDetail] = useState<RecordData | null>(null),
    [busy, setBusy] = useState(false);
  const assets = w.assets.filter(
    (a) =>
      (!kind || a.kind === kind) &&
      `${a.code} ${a.name} ${a.description} ${a.attributes_json}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  async function open(key: string) {
    try {
      setDetail(await api(`/projects/${p}/assets/${key}`));
    } catch (e) {
      fail(e);
    }
  }
  async function mutate(path: string, body: unknown) {
    await api(`/projects/${p}/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    await refresh();
    if (detail) await open(str(detail, "id"));
  }
  return (
    <>
      <div className="section-actions">
        <div>
          <h2>项目资产库</h2>
          <p>基础资产、组合成果与正式版本，都有可追溯的归处。</p>
        </div>
        <button className="primary" onClick={create}>
          ＋ 登记资产
        </button>
      </div>
      <div className="asset-toolbar">
        <input
          aria-label="搜索资产"
          placeholder="搜索编号、名称或内容…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          aria-label="筛选资产类型"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">全部类型</option>
          {[
            "character",
            "costume",
            "prop",
            "scene",
            "composite",
            "document",
            "image",
            "audio",
            "video",
          ].map((k) => (
            <option key={k} value={k}>
              {labels[k]}
            </option>
          ))}
        </select>
        <span className="muted">{assets.length} 项资产</span>
      </div>
      {!assets.length ? (
        <Empty>
          这里还没有匹配的资产。登记资产后，可以上传候选、记录来源并审核定稿。
        </Empty>
      ) : (
        <div className="asset-grid">
          {assets.map((a) => (
            <button
              className="asset-card"
              key={str(a, "id")}
              onClick={() => open(str(a, "id"))}
            >
              <div className={`asset-cover ${a.kind}`}>
                <span>
                  {a.kind === "character"
                    ? "人"
                    : a.kind === "composite"
                      ? "合"
                      : a.kind === "scene"
                        ? "景"
                        : "物"}
                </span>
                <small>{labels[str(a, "kind")]}</small>
              </div>
              <div className="asset-info">
                <div className="row">
                  <span className="mono">{str(a, "code")}</span>
                  {a.approved_version ? (
                    <Badge value="approved" />
                  ) : (
                    <Badge value="candidate" />
                  )}
                </div>
                <h3>{str(a, "name")}</h3>
                <p>{str(a, "description") || "暂无内容说明"}</p>
                <small>
                  {Object.entries(JSON.parse(str(a, "attributes_json")))
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </small>
              </div>
            </button>
          ))}
        </div>
      )}
      {detail && (
        <Dialog
          title={`${detail.code} · ${detail.name}`}
          onClose={() => setDetail(null)}
        >
          <p>{str(detail, "description")}</p>
          <p className="muted">
            角色 / 对象：{str(detail, "entity_key") || "未关联"} · 属性：
            {JSON.stringify(detail.attributes)}
          </p>
          {list(detail.versions).map((v) => (
            <div className="version" key={str(v, "id")}>
              <div className="row">
                <h3>版本 {str(v, "version")}</h3>
                <Badge value={str(v, "status")} />
              </div>
              <small className="mono">{str(v, "id")}</small>
              <p>{str(v, "notes")}</p>
              <div className="file-list">
                {list(v.files).map((f) => (
                  <div key={str(f, "id")}>
                    {[
                      "image/png",
                      "image/jpeg",
                      "image/webp",
                      "image/gif",
                    ].includes(str(f, "mime")) && (
                      <img
                        className="asset-preview"
                        src={str(f, "url")}
                        alt={str(f, "original_name")}
                      />
                    )}
                    <a href={str(f, "url")} target="_blank" rel="noreferrer">
                      {str(f, "original_name")}
                    </a>
                    <small> · {Math.ceil(Number(f.size) / 1024)} KB</small>
                  </div>
                ))}
              </div>
              <p className="muted">
                来源：
                {list(v.sources)
                  .map((a) => `${a.code} ${a.name} V${a.version}`)
                  .join("、") || "基础资产，无组合来源"}
              </p>
              {v.approval_scope ? (
                <p>批准范围：{str(v, "approval_scope")}</p>
              ) : null}
              {v.status === "candidate" && (
                <>
                  <label className="upload-button">
                    ＋ 上传实际文件
                    <input
                      type="file"
                      disabled={busy}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setBusy(true);
                        try {
                          const fd = new FormData();
                          fd.set("file", file);
                          await api(`/projects/${p}/versions/${v.id}/files`, {
                            method: "POST",
                            body: fd,
                          });
                          await open(str(detail, "id"));
                        } catch (err) {
                          fail(err);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </label>
                  <form
                    className="review-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      setBusy(true);
                      try {
                        await mutate(`versions/${v.id}/review`, {
                          decision: fd.get("decision"),
                          scope: fd.get("scope"),
                          reason: fd.get("reason"),
                        });
                      } catch (err) {
                        fail(err);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Field label="本次批准 / 审核范围">
                      <input
                        name="scope"
                        required
                        placeholder="例如：面容与服装，不包含姿势"
                      />
                    </Field>
                    <Field label="审核说明">
                      <input name="reason" placeholder="通过依据，或退回原因" />
                    </Field>
                    <div className="buttons">
                      <select name="decision">
                        <option value="approved">通过并发布</option>
                        <option value="rejected">退回修改</option>
                      </select>
                      <button disabled={busy}>保存审核</button>
                    </div>
                  </form>
                </>
              )}
              <details>
                <summary>来源、下游影响与使用关系</summary>
                <button
                  onClick={async () => {
                    try {
                      const result = await api(
                        `/projects/${p}/versions/${v.id}/lineage`,
                      );
                      window.alert(JSON.stringify(result, null, 2));
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  查询关系
                </button>
              </details>
            </div>
          ))}
          <form
            className="version-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await mutate(`assets/${detail.id}/versions`, {
                  notes: fd.get("notes"),
                  sources: fd.getAll("sources"),
                });
                e.currentTarget?.reset();
              } catch (err) {
                fail(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>新增候选版本</h3>
            <Field label="版本说明">
              <input name="notes" placeholder="本次制作或修改的内容" />
            </Field>
            <Field label="基于哪些定稿生成（基础资产可不选）" group>
              <ReferencePicker
                name="sources"
                options={w.approvedVersions.map((v) => ({
                  value: str(v, "id"),
                  label: `${str(v, "code")} · ${str(v, "name")} · v${str(v, "version")}`,
                }))}
              />
            </Field>
            <button className="primary" disabled={busy}>
              创建候选版本
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
