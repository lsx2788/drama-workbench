# OpenAI 聊天接入

在总控聊天右上角打开「连接 OpenAI」，保存 API Key、文字/视觉模型和图片生成模型。可测试已保存的文字模型访问权限。真实生成还取决于账户额度与对应模型权限。API 独立计费，不复用 ChatGPT/Codex 登录凭据。

配置存于被 Git 忽略的 `data/openai.local.json`；GET 仅返回是否配置、模型名、密钥来源。也可用 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_IMAGE_MODEL` 环境变量覆盖。模型默认值依据 2026-09-16 的官方文档，允许改成账户可用的型号。连接为本机各项目共用，密钥不能进入项目、提示词、调用审计或日志。

## 聊天与原件

- 总控聊天可多选、拖入、移除附件，复用已有原件存储与预览。支持 TXT、Markdown、Word、PDF 和 PNG/JPEG/WebP/GIF；20 个文件，单个 20 MB、合计 50 MB。
- 附件先保存原始字节，再与消息关联；发送失败保留已上传文件，重复提交复用上传键。上传不分析、不 OCR。
- 请求上下文仅载入最近最多 40 条、约 6 万字符消息与文件引用，明确告知旧历史未全量载入。原作 TXT/MD 由分析/编剧 AI 自选范围按需读取，每次最多 48 KB，不固定章节数。旧聊天可分页查阅。
- 图片和 PDF/Word 在模型调用查看工具后才转为 Responses 的多模态输入；PDF/Word 当前整件传入，不支持逐页工具，所以长篇资料建议使用 TXT。网页内链接不直接传给远端作为可访问地址。
- 用户明确提出出图/改图后，总控可调用图片生成工具。PNG 原图保存为公共资产库的候选版本，并关联聊天；刷新后可预览、下载，也可按文件 ID 再查看以继续改图。不会自动定稿。

## 执行与协作

`ai_turns` 保存队列、状态及提交时提示词/模型快照；`ai_calls` 保存每次实际请求、响应 ID、用量和返回内容；`ai_tool_events` 保存工具参数与回执。图片 base64 不重复塞进数据库，以文件摘要和关联文件审计。会话保存最近一次真实 OpenAI response ID。

使用 OpenAI Responses API，无 SDK 自动重试。网页请求只入队，当前常驻本机 Next Node 服务执行任务；浏览器定期查询状态，关闭聊天不会取消任务。该执行方式不用于 serverless 部署或多进程扩容。服务重启后未结束任务标记为 interrupted，不自动重发未知状态的付费调用。失败或调用上限后保留阶段消息、文件和成果，用户发补充消息继续。

同一会话只允许一轮执行，请求键防止网络重发重复提交。每轮最多 20 次模型调用、每个 AI 最多 10 个工具往返、最多 3 层子任务，每次网络调用超时 10 分钟。不自动重复失败的图片生成。

工具按系统身份分配，项目、执行者会话由后端绑定。总控可登记原作分析/编剧并调用直接子 AI；编剧可以委派自己的子 AI。子 AI 独立持久化聊天，父 AI 接收简短结果，也可以接到澄清问题。前期成果、需求确认、改编框架、知识提议与审核、空剧集入口均复用现有域服务的验证。总控没有全文按范围读取工具；子 AI 没有总控审核权限。图片生成作为当前总控聊天的系统能力提供，分析/编剧不获得生图工具。

没有接入任意第三方 Skill 执行、自动总控交接或分集生产全流程；必须以本轮实际工具清单为准，不能将提示词里的目标描述当作已实现能力。旧的 `/sessions/:id/messages` 仍是纯存储接口；网页使用 `/sessions/:id/turns` 发起真实运行。新故事交接在连接已配置时自动入队，未配置时保留消息供之后手动开始。

## 接口

- `GET /api/v1/openai`：不含密钥的连接状态。
- `PATCH /api/v1/openai`：`{apiKey?, model, imageModel}`；省略密钥保持不变。
- `POST /api/v1/openai/test`：校验保存的密钥与文字模型访问。
- `GET /api/v1/projects/:p/sessions/:id/turns`：本会话最近执行状态。
- `POST /api/v1/projects/:p/sessions/:id/turns`：`{requestKey,content,quoteId?,storyIds?}`；或 `{requestKey,messageId}` 处理尚未执行的已存用户消息。
- `GET /api/v1/projects/:p/ai-turns/:id`：实际输入配置、模型调用和工具回执。网页「AI 执行记录」可查看。

迁移 19 仅新增表，不重写既有提示词、故事、聊天或定稿资产。数据库与 files 需共同备份，配置文件包含密钥，独立保护。

官方参考：[Responses 图片生成](https://developers.openai.com/api/docs/guides/image-generation)、[文件输入](https://developers.openai.com/api/docs/guides/file-inputs)、[工具调用](https://developers.openai.com/api/docs/guides/function-calling)。
