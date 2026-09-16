import { z } from "zod";
import type { Store } from "./db";
import { assert, id, projectExists } from "./common";
import { sessionInProject } from "./collaboration-service";
import { listStories, storyDetail } from "./story-service";
import { readStoryRange } from "./story-range";
import {
  listPreparationRecords,
  preparationRecord,
  startPreparation,
  savePreparationRecord,
  reviewPreparation,
} from "./preparation-service";
import { listEpisodes, episodeDetail, createEpisodes } from "./episode-service";
import {
  knowledge,
  proposeKnowledge,
  reviewKnowledge,
  knowledgeProposal,
} from "./knowledge-service";
import { searchAssets, assetDetail } from "./asset-service";
import { delegateWriting, postAgentMessage } from "./writer-collaboration";
import { sourceInput, imageInput } from "./ai-context";
import { readDocument } from "./document-reader";
import { pendingReviews, reviewAsset } from "./result-review";
import {
  askConfirmation,
  chatConfirmations,
  resolveConfirmation,
} from "./chat-confirmations";
import {
  publishGroupMessage,
  groupCandidates,
  setGroupMember,
  groupEnvelope,
} from "./group-service";
import type { AiItem } from "./openai-provider";
import {
  proposeWorkflowOutline,
  workflowOutline,
  workflowOutlines,
} from "./workflow-outline-service";

const contracts: Record<string, string> = {
  confirmations:
    "{}: 查询当前群已登记的用户问题与 pending/answered/skipped 状态。跳过和已回应都不是审批。",
  ask_confirmation:
    "{key,title,content}: 总控向用户提出一个独立待确认问题，自动保存并发布黄色消息。key 是群内唯一标识，重试保持相同；不要在最终回复重复问题。",
  resolve_confirmation:
    "{id,userMessageId,reason}: 总控依据真实用户回答将问题标为已回应；不代表用户同意，不改变成果审核。不完整或有歧义的回复仍保留待确认。",
  pending_reviews:
    "{}: 查询前期成果、知识提议与资产版本的待审核清单，只读。聊天声称通过不会改变清单。",
  knowledge_proposal:
    "{id}: 获取知识提议完整内容、来源和当前审核结果，先读取再审核。",
  review_asset:
    "{id,decision:approved|rejected,scope,reason}: 仅总控可审核本项目资产版本；id 是版本编号，scope 写适用范围，reason 必须给出依据或具体返工要求。退回后生成新候选版本再审，不能覆盖旧审核。",
  propose_workflow_outline:
    "{title,summary,steps:[{key,name,objective,outputs?:[],dependsOn?:[]}],questions?:[],previousId?}: 总控保存待讨论的制作流程大纲，自动在群里显示预览卡片。steps 用局部 key 关联，允许分支但不允许环，最多40步。不会发布或执行正式流程；修订引用 previousId。",
  workflow_outline: "{id}: 按 ID 查询本项目已保存的流程大纲。",
  group_members:
    "{}: 获取可用 AI、真实 session ID 和 available（未参与）/active（在场）/paused（已退出）状态。",
  group_member:
    "{sessionId,status:active|paused}: 总控邀请 AI 重新加入或结束其本轮参与。保留原会话、历史和外部 ID；退出者不再接受用户 @，需要时总控可用 ask_child 恢复。只在当前子任务已返回后操作。",
  state: "{}: 项目信息、原作元信息、成果索引及直接上下级会话。",
  history: "{offset?:number,limit?:number}: 本会话历史，从最近消息倒序分页。",
  read_source_range:
    '{storyId,startByte,endByte,encoding:"utf-8"|"gb18030"}: 按字节范围读 TXT/MD，单次最多 48KB。由你决定范围，不固定章节；要标注局部阅读。',
  read_document:
    "{storyId,page?:number,start?:number,length?:number}: 按需读 PDF 指定页（从1开始）或 DOCX；start 从0开始，length 最多24000字符。返回页数、文本长度与读取范围；不做 OCR。",
  view_source:
    "{storyId}: 看原始图片或把 PDF/Word 交模型读取。文档全件计入上下文，长篇小说优先 TXT 分段。",
  view_asset_image: "{fileId}: 查看本项目已存图片，后续编辑必须先看。",
  assets: "{code?,kind?,entityKey?,status?,attributes?}: 精确查询资产。",
  asset: "{id}: 获取资产和版本。",
  records: "{}: 前期成果简表。",
  record:
    "{id}: 获取具体成果及真实审核标记、usable 使用资格与不可用原因；只能将 usable=true 的版本用于正式下游。",
  knowledge: "{}: 已审核共用知识及提议。",
  episodes: "{around?,before?,after?,offset?,limit?}: 按编号查相邻集或分页。",
  episode: "{id}: 剧集 ID 或 E0001，获取原文引用。",
  prepare:
    "{profile:source-analysis|screenwriting}: 按当前任务仅创建或查找这一种专业 AI，返回 sessionId。不创建其他 AI，也不自动加入群或执行。先 group_members/state 查已有会话，需要谁就 ask_child 邀请谁。",
  ask_child:
    "{sessionId,content,sourceIds?:[],recordIds?:[],episodeIds?:[]}: 邀请或恢复指定直接子 AI 并等待回复。content 是群里可见的自然语言任务，不写 UUID、哈希、接口名或技术路径；技术引用放对应 ID 数组，由后台单独传递。不要复制原文。调用不会邀请其他 AI。",
  delegate_writer:
    "{name,objective,sourceIds?:[],recordIds?:[],episodeIds?:[]}: 编剧自行建立子任务，返回 child_session_id，随后 ask_child。",
  save_record:
    "{kind:overview|requirements|framework,basisId?,previousId?,content:{title,summary,details?,unresolved?:[],sources?:[{storyId,startByte?,endByte?,encoding?,locator?}],episodeCount?,minutesPerEpisode?,scope?,constraints?:[]}}: 保存成果。requirements 引用 confirmed overview；framework 引用 confirmed requirements。",
  review_record:
    "{id,decision:confirmed|changes_requested,reason,userMessageId?}: 总控审核；需求/框架确认必须引用真正表达确认的用户消息，不得把提问/上传当批准。",
  create_episodes:
    "{frameworkId,units:[{name,kind:episode|chapter,summary,sources:[{storyId,startByte?,endByte?,encoding?,locator?}],assetVersionIds?:[]}]}: 编剧以已确认框架创建空剧集入口并关联原文。",
  propose_knowledge:
    "{summary,entities?:[{code,name,kind:person|concept|setting,role?,description?,sources?:[],assetVersionIds?:[],expectedRevision?}],relations?:[{code,from,to,label,period?,description?,sources?:[],expectedRevision?}]}: 子 AI 提交公共知识增补，待总控审核。",
  review_knowledge:
    "{id,decision:confirmed|changes_requested,reason}: 总控审核知识提议。",
};
export function toolActions(profile: string) {
  const common = [
    "state",
    "history",
    "view_source",
    "view_asset_image",
    "assets",
    "asset",
    "records",
    "record",
    "knowledge",
    "knowledge_proposal",
    "pending_reviews",
    "episodes",
    "episode",
    "group_members",
  ];
  if (profile === "coordinator")
    return [
      ...common,
      "confirmations",
      "ask_confirmation",
      "resolve_confirmation",
      "prepare",
      "ask_child",
      "save_record",
      "review_record",
      "review_knowledge",
      "review_asset",
      "group_member",
      "propose_workflow_outline",
      "workflow_outline",
    ];
  if (profile === "source-analysis")
    return [
      ...common,
      "read_source_range",
      "read_document",
      "save_record",
      "propose_knowledge",
    ];
  if (profile === "screenwriting")
    return [
      ...common,
      "read_source_range",
      "read_document",
      "save_record",
      "propose_knowledge",
      "delegate_writer",
      "ask_child",
      "create_episodes",
    ];
  return common;
}
export function workbenchTool(
  profile: string,
  provider: "openai" | "codex" = "openai",
) {
  const actions = toolActions(profile);
  return {
    type: "function",
    name: "workbench",
    description:
      "调用当前项目的确定性接口。data 是严格遵循相应契约的 JSON 字符串；身份与项目由服务器绑定，不能传 actor/session 伪装他人。\n" +
      actions
        .map(
          (a) =>
            `${a}: ${a === "view_source" && provider === "codex" ? "{storyId}: 查看原始图片。PDF/DOCX 请交原作分析 AI 用 read_document 按范围读取；旧 DOC 需转换。" : contracts[a]}`,
        )
        .join("\n"),
    strict: true,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: actions },
        data: { type: "string", description: "参数 JSON 字符串，无参数传 {}" },
      },
      required: ["action", "data"],
      additionalProperties: false,
    },
  };
}
export function projectState(s: Store, p: string, sessionId: string) {
  const ss = sessionInProject(s, p, sessionId);
  return {
    project: projectExists(s, p),
    sessionId,
    sources: listStories(s, p).slice(0, 200),
    records: listPreparationRecords(s, p),
    workflowOutlines: workflowOutlines(s, p).map((r) => ({
      id: r.id,
      revision: r.revision,
      previousId: r.previous_id,
      title: r.content.title,
    })),
    sessions: s.all(
      "SELECT ss.id,ss.title,a.name,a.id AS agent_id,n.node_type,pr.profile_id FROM sessions ss JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id LEFT JOIN node_ai_profiles pr ON pr.node_id=n.id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? AND ss.status='open' AND (a.id=? OR a.id IN (SELECT child_id FROM ai_relations WHERE parent_id=?) OR a.id IN (SELECT parent_id FROM ai_relations WHERE child_id=?))",
      p,
      String(ss.agent_id),
      String(ss.agent_id),
      String(ss.agent_id),
    ),
  };
}
export type ChildRunner = (
  sessionId: string,
  messageId: string,
) => Promise<unknown>;
export async function executeTool(
  s: Store,
  p: string,
  sessionId: string,
  profile: string,
  input: unknown,
  runChild: ChildRunner,
  group?: { id: string; triggerId: string; promptVersion?: number },
): Promise<{ result: unknown; media?: AiItem }> {
  const call = z
    .object({ action: z.string(), data: z.string().max(100_000) })
    .strict()
    .parse(input);
  assert(toolActions(profile).includes(call.action), "当前 AI 没有此工具权限");
  const d = z.record(z.string(), z.unknown()).parse(JSON.parse(call.data));
  const key = () => z.uuid().parse(d.id);
  let result: unknown;
  switch (call.action) {
    case "confirmations":
      result = chatConfirmations(s, p, sessionId);
      break;
    case "ask_confirmation":
      assert(
        group && group.id === sessionId,
        "只能由当前群总控提出用户待确认问题",
      );
      result = askConfirmation(
        s,
        p,
        sessionId,
        d,
        group.triggerId,
        group.promptVersion,
      );
      break;
    case "resolve_confirmation":
      result = resolveConfirmation(s, p, sessionId, d);
      break;
    case "pending_reviews":
      result = pendingReviews(s, p);
      break;
    case "knowledge_proposal":
      result = knowledgeProposal(s, p, key());
      break;
    case "review_asset": {
      const { id: versionId, ...review } = d;
      result = reviewAsset(s, p, sessionId, z.uuid().parse(versionId), review);
      break;
    }
    case "propose_workflow_outline":
      assert(group && group.id === sessionId, "流程大纲由本群总控制定");
      result = proposeWorkflowOutline(
        s,
        p,
        sessionId,
        d,
        group.triggerId,
        group.promptVersion,
      );
      break;
    case "workflow_outline":
      result = workflowOutline(s, p, key());
      break;
    case "group_members":
      assert(group, "当前调用不在群聊执行中");
      result = groupCandidates(s, p, group.id);
      break;
    case "group_member": {
      assert(group && sessionId === group.id, "只有本群总控可以调整成员");
      const q = z
        .object({ sessionId: z.uuid(), status: z.enum(["active", "paused"]) })
        .strict()
        .parse(d);
      result = setGroupMember(s, p, group.id, q.sessionId, q.status, true);
      break;
    }
    case "read_document": {
      const { storyId, ...range } = d;
      result = await readDocument(s, p, z.uuid().parse(storyId), range);
      break;
    }
    case "state":
      result = projectState(s, p, sessionId);
      break;
    case "history": {
      const q = z
        .object({
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(10).default(10),
        })
        .strict()
        .parse(d);
      result = s
        .all(
          "SELECT id,sender_type,sender_id,content,created_at FROM messages m WHERE session_id=? OR EXISTS(SELECT 1 FROM group_deliveries d WHERE d.message_id=m.id AND d.session_id=?) ORDER BY rowid DESC LIMIT ? OFFSET ?",
          sessionId,
          sessionId,
          q.limit,
          q.offset,
        )
        .map((message) => ({
          ...message,
          group: groupEnvelope(s, String(message.id)),
          references: JSON.parse(
            String(
              s.one(
                "SELECT references_json FROM message_context WHERE message_id=?",
                String(message.id),
              )?.references_json ?? "{}",
            ),
          ),
        }));
      break;
    }
    case "view_source":
      return {
        result: { viewedSourceId: z.uuid().parse(d.storyId) },
        media: sourceInput(s, p, String(d.storyId)),
      };
    case "view_asset_image":
      return {
        result: { viewedFileId: z.uuid().parse(d.fileId) },
        media: imageInput(s, p, String(d.fileId)),
      };
    case "read_source_range": {
      const { storyId, ...range } = d;
      assert(
        Number(d.endByte) - Number(d.startByte) <= 48 * 1024,
        "请将本次读取范围缩小到 48 KB 内",
      );
      result = readStoryRange(s, p, z.uuid().parse(storyId), range);
      break;
    }
    case "assets":
      result = searchAssets(s, p, d);
      break;
    case "asset":
      result = assetDetail(s, p, key());
      break;
    case "records":
      result = listPreparationRecords(s, p);
      break;
    case "record":
      result = preparationRecord(s, p, key());
      break;
    case "knowledge":
      result = knowledge(s, p);
      break;
    case "episodes":
      result = listEpisodes(s, p, d);
      break;
    case "episode":
      result = episodeDetail(s, p, z.string().parse(d.id));
      break;
    case "prepare":
      result = startPreparation(s, p, {
        ...d,
        coordinatorSessionId: sessionId,
      });
      break;
    case "save_record":
      result = savePreparationRecord(s, p, {
        ...d,
        authorSessionId: sessionId,
      });
      break;
    case "review_record": {
      const { id: recordId, ...rest } = d;
      result = reviewPreparation(s, p, z.uuid().parse(recordId), {
        ...rest,
        coordinatorSessionId: sessionId,
      });
      break;
    }
    case "delegate_writer": {
      result = delegateWriting(
        s,
        p,
        {
          ...d,
          parentSessionId: sessionId,
          requestKey: id(),
        },
        group
          ? (childId, messageId) => {
              setGroupMember(s, p, group.id, childId, "active", true);
              publishGroupMessage(
                s,
                p,
                group.id,
                messageId,
                [childId],
                [],
                group.triggerId,
              );
            }
          : undefined,
      );
      break;
    }
    case "create_episodes":
      result = createEpisodes(s, p, {
        ...d,
        writerSessionId: sessionId,
        requestKey: id(),
      });
      break;
    case "propose_knowledge":
      result = proposeKnowledge(s, p, {
        payload: d,
        authorSessionId: sessionId,
      });
      break;
    case "review_knowledge": {
      const { id: proposalId, ...rest } = d;
      result = reviewKnowledge(s, p, z.uuid().parse(proposalId), {
        ...rest,
        coordinatorSessionId: sessionId,
      });
      break;
    }
    case "ask_child": {
      const q = z
        .object({
          sessionId: z.uuid(),
          content: z.string().min(1).max(10000),
          sourceIds: z.array(z.uuid()).max(30).default([]),
          recordIds: z.array(z.uuid()).max(30).default([]),
          episodeIds: z.array(z.uuid()).max(30).default([]),
        })
        .strict()
        .parse(d);
      const from = sessionInProject(s, p, sessionId),
        to = sessionInProject(s, p, q.sessionId);
      assert(
        s.one(
          "SELECT 1 FROM ai_relations WHERE parent_id=? AND child_id=?",
          String(from.agent_id),
          String(to.agent_id),
        ),
        "只能执行直接子 AI",
      );
      const posted = s.transaction(() => {
        q.sourceIds.forEach((key) => storyDetail(s, p, key));
        q.recordIds.forEach((key) => preparationRecord(s, p, key));
        q.episodeIds.forEach((key) => episodeDetail(s, p, key));
        if (group) setGroupMember(s, p, group.id, q.sessionId, "active", true);
        const posted = postAgentMessage(s, p, q.sessionId, {
          fromSessionId: sessionId,
          content: q.content,
        });
        s.run(
          "INSERT INTO message_context VALUES(?,?)",
          String(posted.message!.id),
          JSON.stringify({
            sourceIds: q.sourceIds,
            recordIds: q.recordIds,
            episodeIds: q.episodeIds,
          }),
        );
        [...new Set(q.sourceIds)].forEach((key, position) =>
          s.run(
            "INSERT INTO chat_attachments VALUES(?,?,?)",
            String(posted.message!.id),
            key,
            position,
          ),
        );
        if (group)
          publishGroupMessage(
            s,
            p,
            group.id,
            String(posted.message!.id),
            [q.sessionId],
            [q.sessionId],
            group.triggerId,
          );
        return posted;
      });
      result = await runChild(q.sessionId, String(posted.message!.id));
      break;
    }
  }
  return { result };
}
