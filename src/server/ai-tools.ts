import { z } from "zod";
import type { Store } from "./db";
import { assert, id, projectExists } from "./common";
import { sessionInProject } from "./collaboration-service";
import { listStories } from "./story-service";
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
} from "./knowledge-service";
import { searchAssets, assetDetail } from "./asset-service";
import { delegateWriting, postAgentMessage } from "./writer-collaboration";
import { sourceInput, imageInput } from "./ai-context";
import type { AiItem } from "./openai-provider";

const contracts: Record<string, string> = {
  state: "{}: 项目信息、原作元信息、成果索引及直接上下级会话。",
  history: "{offset?:number,limit?:number}: 本会话历史，从最近消息倒序分页。",
  read_source_range:
    '{storyId,startByte,endByte,encoding:"utf-8"|"gb18030"}: 按字节范围读 TXT/MD，单次最多 48KB。由你决定范围，不固定章节；要标注局部阅读。',
  view_source:
    "{storyId}: 看原始图片或把 PDF/Word 交模型读取。文档全件计入上下文，长篇小说优先 TXT 分段。",
  view_asset_image: "{fileId}: 查看本项目已存图片，后续编辑必须先看。",
  assets: "{code?,kind?,entityKey?,status?,attributes?}: 精确查询资产。",
  asset: "{id}: 获取资产和版本。",
  records: "{}: 前期成果简表。",
  record: "{id}: 获取具体成果。",
  knowledge: "{}: 已审核共用知识及提议。",
  episodes: "{around?,before?,after?,offset?,limit?}: 按编号查相邻集或分页。",
  episode: "{id}: 剧集 ID 或 E0001，获取原文引用。",
  prepare:
    "{}: 登记原作分析、编剧 AI 及会话，返回会话 ID；本操作不执行子 AI。随后 ask_child 开始讨论。",
  ask_child:
    "{sessionId,content}: 给直接子 AI 发任务并等待其本轮回复。子 AI 可提问，由你解释或向用户询问。不要把整本原文复制给子 AI，用编号。",
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
    "episodes",
    "episode",
  ];
  if (profile === "coordinator")
    return [
      ...common,
      "prepare",
      "ask_child",
      "save_record",
      "review_record",
      "review_knowledge",
    ];
  if (profile === "source-analysis")
    return [...common, "read_source_range", "save_record", "propose_knowledge"];
  if (profile === "screenwriting")
    return [
      ...common,
      "read_source_range",
      "save_record",
      "propose_knowledge",
      "delegate_writer",
      "ask_child",
      "create_episodes",
    ];
  return common;
}
export function workbenchTool(profile: string) {
  const actions = toolActions(profile);
  return {
    type: "function",
    name: "workbench",
    description:
      "调用当前项目的确定性接口。data 是严格遵循相应契约的 JSON 字符串；身份与项目由服务器绑定，不能传 actor/session 伪装他人。\n" +
      actions.map((a) => `${a}: ${contracts[a]}`).join("\n"),
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
      result = s.all(
        "SELECT id,sender_type,sender_id,content,created_at FROM messages WHERE session_id=? ORDER BY rowid DESC LIMIT ? OFFSET ?",
        sessionId,
        q.limit,
        q.offset,
      );
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
      startPreparation(s, p, { coordinatorSessionId: sessionId });
      result = projectState(s, p, sessionId);
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
    case "delegate_writer":
      result = delegateWriting(s, p, {
        ...d,
        parentSessionId: sessionId,
        requestKey: id(),
      });
      break;
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
        .object({ sessionId: z.uuid(), content: z.string().min(1).max(10000) })
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
      const posted = postAgentMessage(s, p, q.sessionId, {
        fromSessionId: sessionId,
        content: q.content,
      });
      result = await runChild(q.sessionId, String(posted.message!.id));
      break;
    }
  }
  return { result };
}
