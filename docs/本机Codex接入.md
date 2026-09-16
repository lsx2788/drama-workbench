# 本机 Codex 接入

总控聊天右上角「AI 连接 → 本机 Codex」使用 `codex app-server --stdio`，由 Codex 管理 ChatGPT 登录和订阅额度。工作台不读取、复制或返回 OAuth 凭据，不自动退回 API Key 计费。OpenAI API 保留为手动切换的连接方式。

要求 `codex login status` 显示 ChatGPT 登录；运行工作台的账号能从 PATH 找到原生可执行文件，或用 `CODEX_BIN` 指定。已验证 `codex-cli 0.154.0-alpha.6.2`，动态工具协议随版本变化可能需要适配。模型列表取自本机服务。电脑与常驻 Node 服务需要保持运行，当前不支持多进程 worker。

## 存储和续接

- `data/ai-connection.local.json` 保存提供方和模型，不含凭据；缺少此文件时沿用原 OpenAI 配置，不自动改变既有用户的计费方式。
- schema 20 的 `codex_sessions` 保存工作台 Session 对应的 Codex Thread、工具契约摘要和已投递消息位置；外部 ID 同步写入 `sessions.external_session_id`。
- 初次载入最近最多 40 条、约 6 万字符聊天和文件引用；恢复 Thread 后只发送新增消息。完整外部上下文由 Codex 管理，本地数据库仍是网页消息与成果的来源。
- 每轮带入锁定的系统规则和内容提示词版本。动态工具契约改变时建立新 Thread，旧 ID 保留在 `ai_calls` 审计中，以本地近期聊天续接。
- `ai_turns` 保存提供方/模型/提示词快照；`ai_calls` 保存实际输入和输出；`ai_tool_events` 保存项目工具记录。断线或重启不自动重发状态未知的请求，已有成果保留。

## 执行边界

总控可使用项目查询、前期准备、审核与子 AI 委派；原作分析 AI 按需读原文；编剧可委派自己的子 AI。身份、节点能力和项目范围在服务器绑定，不接受模型指定任意文件路径或冒充其他身份。

App Server 使用独立工作目录、只读沙箱，关闭继承的 MCP、插件、Shell、浏览器、网页搜索、原生多代理等能力，只通过动态 `workbench` 工具访问项目。总控按账号能力开放原生图片生成。Skill 描述不代表已安装或可任意执行。

一轮最多 20 次工作台 AI 协作、80 次项目工具调用、3 层委派，累计媒体最多 64 MB。单个 Codex Turn 超过 15 分钟请求停止。Codex 内部模型调用由其管理，这些限制不是订阅 token 的精确预算。网页按消息完成事件更新，尚未实现逐字流式显示。

## 文件与图片

上传只保存原始字节和元信息；AI 显式请求工具时才读取。TXT/Markdown 按明确编码和字节范围读取。PDF 按页提取文字，DOCX 按字符范围返回，每次最多 24,000 字符；DOCX 工具内部提取正文再截取，不自动把全文发送给模型。扫描 PDF、文档内图片和版式不包含在文字提取结果中；旧 DOC 需转换为 DOCX/TXT。原件不修改、不自动 OCR。

原始图片和资产图片通过工具传给模型。生成图片保存为 PNG 候选资产，聊天可预览和再次引用，不自动定稿。

## 验证

`npm test` 包含线程隔离、重复事件/工具去重、增量续接、提示词更新、断线不重发、凭据隔离和 PDF/DOCX 范围读取；另运行类型检查和正式构建。

手动验收命令会使用已登录账号的额度：

```sh
npx tsx scripts/check-codex.ts
npx tsx scripts/check-codex.ts --smoke
npx tsx scripts/check-workbench-codex.ts --image
```

完整验收已验证工具查询、两轮记忆、原作分析子 AI 读取并存概况、图片查看和生成入库。数据位于独立的 `data/codex-integration-*`，不写正式项目，不进入 Git。

官方协议：[App Server](https://learn.chatgpt.com/docs/app-server)、[认证](https://learn.chatgpt.com/docs/auth)。安装版本生成的本地协议是实际兼容依据。
