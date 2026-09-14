# 映序 · Drama Workbench

面向 AI 短剧制作的项目底座：以流程节点组织 AI，以明确版本管理成果，以持久化重点记录代替反复翻聊天。

## 本地运行

要求 Node.js 24.11+，npm。

```sh
npm install
npm run dev
```

打开 http://127.0.0.1:3000 。首次启动自动创建 SQLite 数据库。没有自动插入假项目；可在界面创建项目。

```sh
npm test
npm run typecheck
npm run build
npm start
```

## 技术选择

- TypeScript + Next.js App Router + React：网页与标准 HTTP API 共用业务服务。
- Node.js 内置 SQLite：本机无需单独启动数据库。SQL 与文件存储封装在服务层，未来迁移 PostgreSQL 需要显式迁移，非无成本切换。
- 本地文件存储：数据库保存相对文件键和元信息，API 提供文件访问。未来替换为对象存储。
- Zod 校验输入，Node test + tsx 验证业务不变量。

数据库和素材位于 data/，不上传 GitHub。DATA_DIR 可修改目录；同时备份数据库与 files/，备份前停止服务。

## 范围

当前实现范围及已验证能力见 docs/实施状态.md；设计全案见 [方案](docs/方案.md)，接口见 [API](docs/API.md)。

第一版仅绑定 localhost，不带团队鉴权。WORKBENCH_TOKEN 可保护 API（请求使用 Authorization: Bearer），设置后网页需自行携带令牌；没有登录界面。不要直接暴露公网。

AI 身份、能力配置、会话和执行记录是持久化基础设施。未配置真实执行器时，发送消息只保存消息，运行状态为 blocked，不产生假 AI 回答。不会使用 Codex/ChatGPT 浏览器登录凭据替用户调用模型。
