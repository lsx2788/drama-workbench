# 标准 API v1

所有请求返回 `{data,error,requestId}`；错误为 `{code,message}`。400 参数错误、404 不存在、409 状态/引用冲突、401 令牌缺失、403 跨来源写入。文件接口直接返回二进制。

API 不调用 AI 推理，不自动放宽筛选。每项资源先验证 projectId。外部 agent API 认证和提供方执行器尚未接入，不能伪造 agent 消息或成功执行。

## 项目及流程

- GET/POST `/api/v1/projects`：列表 / 创建。POST `{name,description?,goal?}`。
- GET `/api/v1/projects/:p/overview`：聚合总览。
- GET `/api/v1/projects/:p/workspace`：网页聚合数据（小项目版本，分页后续增加）。
- POST `/api/v1/projects/:p/documents`：`{title,kind: outline|script|note,content,supersedesId?}`。
- POST `/api/v1/projects/:p/workflows`：`{name}`，仅创建草案。
- POST `/api/v1/projects/:p/nodes`：`{workflowId,name,objective?,nodeType?:work|coordinator,dependencies?:nodeId[]}`。
- POST `/api/v1/projects/:p/workflows/:id/activate`：正式发布，旧流程归档；进行中的旧节点必须先处理。
- PATCH `/api/v1/projects/:p/nodes/:id`：`{status}`；依赖/未完成事项会阻止提前完成。

## AI、会话与重点

- POST `.../:p/agents`：`{nodeId,name,purpose,instructions?,provider?,model?,tools?:string[]}`。不存在岗位表。
- POST `.../:p/sessions`：`{agentId,title,externalSessionId?,predecessorId?}`。接续绑定同一 AI。
- POST `.../:p/sessions/:id/messages`：`{content,quoteId?}`。只允许 local-user 写总控会话；发送只保存，不冒充模型回复。
- POST `.../:p/highlights`：`{nodeId,kind:goal|decision|question|next_step,status?:proposed|confirmed,content,rationale?,sourceMessageId?,supersedesId?}`。
- POST `.../:p/highlights/:id/confirm`：确认提议。替代需创建新 confirmed 重点并明确 supersedesId。
- POST `.../:p/skills`：`{id,name,version,description?,capability}`。只登记元信息，不下载或执行。
- POST `.../:p/agents/:id/skills`：`{skillId}`。必须属于 AI 允许的能力类别。

## 资产

- POST `.../:p/assets`：`{code,name,kind,description?,entityKey?,attributes?:object}`。code 在项目内唯一。
- GET `.../:p/assets?code=001&attributes={"age":40}`：属性精确匹配。可用筛选：code、kind、entityKey、status、attributes。参数应 URL 编码。
- GET `.../:p/assets/:id`：元信息、版本、实际文件访问 URL、来源和审核。
- POST `.../:p/assets/:id/versions`：`{notes?,sources?:versionId[]}`。仅接受同项目已定稿来源。
- POST `.../:p/versions/:id/files`：multipart/form-data 的 `file` 字段；1 B～50 MB。只能向候选增加文件。
- POST `.../:p/versions/:id/review`：`{decision:approved|rejected,scope,reason?}`。批准时检查实际文件和内容摘要，审核+发布同事务。
- GET `.../:p/versions/:id/lineage`：祖先、后代及直接事项引用。
- GET `.../:p/files/:id`：实际文件。仅安全媒体 MIME 内联；其他类型作为下载，禁用 HTML 执行。

kind：character/costume/prop/scene/composite/document/image/audio/video。

## 事项和运行

- POST `.../:p/items`：`{nodeId,title,objective?,owner?,agentId?,acceptance?,inputs?:versionId[],dependencies?:itemId[]}`。
- PATCH `.../:p/items/:id`：`{status,reason?}`。完成需说明依据，阻塞需说明原因；运行态不允许手工冒充。
- GET `.../:p/items/:id/context`：目标、节点、已确认重点、输入文件与配置。不含废稿聊天。
- POST `.../:p/runs`：`{itemId,sessionId,idempotencyKey}`。事项必须 ready、会话匹配执行 AI。同键同参数返回同记录；没有执行器时 blocked，不提交外部任务。

示例：

```sh
curl http://127.0.0.1:3000/api/v1/projects
```

所有写入应使用 Content-Type: application/json（上传除外）。配置 WORKBENCH_TOKEN 后需要 Authorization: Bearer。第一版网页无令牌登录页，默认限本机，不可直接用于公网多用户。
