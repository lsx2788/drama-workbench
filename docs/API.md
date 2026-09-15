# 标准 API v1

所有请求返回 `{data,error,requestId}`；错误为 `{code,message}`。400 参数错误、404 不存在、409 状态/引用冲突、401 令牌缺失、403 跨来源写入。文件接口直接返回二进制。

API 不调用 AI 推理，不自动放宽筛选。每项资源先验证 projectId。外部 agent API 认证和提供方执行器尚未接入，不能伪造 agent 消息或成功执行。

## 项目及流程

- GET/POST `/api/v1/projects`：列表 / 创建。POST `{name,description?,goal?}`。创建时原子初始化一个可用流程、总控节点、未配置执行器的总控 AI 和一条空会话，不预设其他制作节点。响应仍为项目记录，通过 workspace 查询初始流程与节点 ID。
- GET `/api/v1/projects?archived=true`：已归档项目列表，默认列表只含未归档项目。
- PATCH `/api/v1/projects/:p/archive`：`{archived:true|false}`，归档或恢复目录显示；原始资料仍保留且可按 ID 查询，不改变制作状态。
- GET `/api/v1/projects/:p/overview`：聚合总览。
- GET `/api/v1/projects/:p/workspace`：网页聚合数据（小项目版本，分页后续增加）。
- POST `/api/v1/projects/:p/documents`：`{title,kind: outline|script|note,content,supersedesId?}`。
- POST `/api/v1/projects/:p/workflows`：`{name}`，仅创建草案。
- POST `/api/v1/projects/:p/nodes`：`{workflowId,name,sectionId?,objective?,nodeType?:work|coordinator,dependencies?:nodeId[]}`。草案和已发布流程均可追加；前置引用必须属于同流程。可给已存在的空分集逐步添加步骤，不复制会话或改写已有普通节点依赖。总控只能不分组或属于共用前期。归档分组中的新节点自动连接当前制作出口；后续新增制作节点会为未开始的归档补足门槛并留下审计记录。归档节点或事项已经开始、自动连线会成环时，整次追加回滚。
- POST `/api/v1/projects/:p/seasons`：`{workflowId,name,description?,unitIds?:sectionId[]}`，可选的季分组。允许先建空季，或把同流程下尚未归季的分集/章节归入新季；不移动节点或复制会话，不改变执行依赖。跨流程、重复归属或同名季拒绝，整次操作原子完成。
- POST `/api/v1/projects/:p/sections`：`{workflowId,name,phase:preparation|unit|delivery,kind?:shared|episode|chapter,seasonId?}`，草案和已发布流程均可增加分组。只有分集/章节可带 `seasonId`。节点创建可附 `sectionId`，必须属于同一流程。
- POST `/api/v1/projects/:p/units`：`{workflowId,name,kind:episode|chapter,seasonId?,dependencies?:nodeId[],steps?:[{key,name,objective?,dependencies?:key[],ai?:{name,purpose,instructions?}}]}`。前期与归档节点不必预先存在，`steps` 可省略或为空；空单元后续通过 nodes 接口补充，但未定义步骤前会阻止归档节点与事项推进。分集顶层 `dependencies` 指定入口依赖，省略时使用现有共用前期出口，没有前期则无隐式依赖；空分集不接受非空入口依赖，避免丢失约束。步骤内依赖只引用本批已声明步骤。整次失败回滚，保留历史资料；同一季内同名分组或归档已开始时拒绝扩展。
- POST `/api/v1/projects/:p/workflows/:id/activate`：正式发布，旧流程归档；进行中的旧节点必须先处理。
- PATCH `/api/v1/projects/:p/nodes/:id`：`{status}`；依赖/未完成事项会阻止提前完成。

## 原始故事

GET `/api/v1/story-preferences` 从数据库返回启用的制作偏好类别及选项，按配置顺序展示。当前五类为画面风格、制作范围、改编要求、单集时长、画幅。初始化种子仅运行一次，重启不会覆盖已调整的选项。前端通过接口获取，服务端按同一数据库目录校验。

故事导入仅接受原文和来源字段，不接受 `preferences`、`ideas` 或旧版 `style/customStyle`。用户选择与补充想法只作为下一次总控聊天的输入，不建立独立偏好记录，故事详情不返回 `brief`。旧偏好表仅保留历史数据，运行时不再读写；旧聊天内容保持原样。后续结论由总控按职责调用文稿、重点等接口记录，不在导入或交接时自动写入项目设置。

- POST `/api/v1/projects/:p/stories/:id/discussion`：`{agentId?,preferences?:[{category,option,detail}],ideas?}`，独立于导入的讨论交接。仅提交选中类别；省略或空数组表示留待讨论。每类只能出现一次，选项必须属于启用类别；需要补充时 `detail` 必填，否则为空串，最多 300 字符。`ideas` 最多 5000 字符。这些输入只格式化成消息正文，不另存结构化用户选择。优先使用当前已发布流程总控；尚无已发布流程时允许草案讨论容器内总控，候选有多个时必须指定。复用唯一空会话，否则建立该故事的讨论会话。保存一条带选择、想法和故事引用的用户消息，返回 `{nodeId,sessionId,messageId,delivery:"stored",execution:"not_configured"}`。同故事重试返回首次成功交接，不重复发消息或改写历史；之后的想法调整通过普通聊天继续。失败保留原始故事，未发送内容留在当前表单供重试（不持久化表单草稿）；不读取正文，不调用模型。

- POST `/api/v1/projects/import-story`：创建项目并保存故事。字段 `source=text|file`、`title?`、`importKey`（UUID）；文本方式用 JSON 传 `text`（避免 multipart 文本字段改写换行），文件方式用 multipart 传 `file`。返回 `{project,story}`，新项目只有未发布的讨论容器、总控及空会话，overview.workflow 为 null。
- POST `/api/v1/projects/:p/stories`：同样的表单字段，将故事追加到已有项目，不覆盖其他来源。返回 `{project,story}`。
- GET `/api/v1/projects/:p/stories`：来源元信息列表；workspace 的 `stories` 同样不携带完整正文。
- GET `/api/v1/projects/:p/stories/:id`：仅返回来源元信息与 `download_url`，不读取文件正文，不返回解析结果或预览。后续 AI 可按故事 ID 查询并取得原文件。
- GET `/api/v1/projects/:p/stories/:id/download`：下载原始字节，强制附件响应，按项目校验归属。

支持 `.txt/.md/.doc/.docx/.pdf`，文件 1 B～20 MB，粘贴正文最多 200 万字符且不能全为空白。原文不 trim、不改写，原始文件不进入 Git。`importKey` 同参数重试返回已有结果；同键不同参数返回 409。保存失败不留下半成品项目。存储接口仅保存文本或原始文件及元信息，不识别编码、不提取正文、不生成预览；解析由后续 AI 负责。

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

故事讨论首次消息包含 `故事原文路径：<download_url>`。该路径返回已落盘的原始字节，粘贴内容对应 UTF-8 `.txt` 文件；消息不嵌入故事正文。聊天界面将原文路径显示为文件名，点击弹窗预览，不改变保存的消息；独立浏览地址仍为 `/?project=<projectId>&story=<storyId>`。原文浏览仅在用户打开页面后读取文件，导入与元信息接口仍不解码、不解析故事。

故事文件导入支持 PNG、JPG/JPEG、WebP、GIF 图片（仍为单文件，最大 20 MB）。以原始字节保存，元信息返回对应 image MIME；原始下载接口与讨论中的文件路径保持一致，不 OCR、不解析图片。
