import { pathToFileURL } from "node:url";
import { Store } from "../src/server/db";
import {
  createProject,
  createDocument,
  createWorkflow,
  createNode,
  activateWorkflow,
} from "../src/server/project-service";
import {
  createAgent,
  createSession,
  createHighlight,
} from "../src/server/collaboration-service";
import {
  createAsset,
  createVersion,
  addFile,
  reviewVersion,
} from "../src/server/asset-service";
import { createItem } from "../src/server/work-service";
import { audit } from "../src/server/common";
import { demoName, outline, script, stages, demoAssets } from "./demo-data";

/** Explicit, repeatable fixture creation. Existing projects are never rewritten. */
export function seedDemo(s: Store) {
  const previous = s.one(
    "SELECT p.id FROM projects p JOIN audit_events a ON a.project_id=p.id WHERE a.action='demo.seeded' AND a.target_id='qinghe-v1'",
  );
  if (previous) return String(previous.id);
  if (s.one("SELECT id FROM projects WHERE name=?", demoName))
    throw new Error(
      "同名项目已存在但未完成样例登记，请检查该项目后再运行，避免覆盖资料。",
    );
  const project = createProject(s, {
    name: demoName,
    description:
      "3 集古装悬疑漫剧的完整流程示例。点击节点查看交付与讨论；演示文字已入库，图像和音视频待制作。",
    goal: "以《青禾剑录》演示从故事到成片归档的 16 个节点。所有节点为待开始；已保存的设定规范不代表图像或视频已完成。",
  });
  const p = String(project.id);
  createDocument(s, p, {
    title: "青禾剑录 · 故事大纲",
    kind: "outline",
    content: outline,
  });
  createDocument(s, p, {
    title: "第 1 集 · 渡口藏账",
    kind: "script",
    content: script,
  });
  const workflow = createWorkflow(s, p, {
    name: "青禾剑录 · 完整制作流程（演示）",
  })!;
  const nodes = new Map<string, string>(),
    agents = new Map<string, string>(),
    versions = new Map<string, string>(),
    items = new Map<string, string>();
  for (const stage of stages) {
    const node = createNode(s, p, {
      workflowId: workflow.id,
      name: stage.name,
      nodeType: stage.key === "control" ? "coordinator" : "work",
      dependencies: stage.parents.map((key) => nodes.get(key)!),
      objective: `目标：${stage.name}。\n输入：${stage.input}\n交付：${stage.output}\n审核要点：${stage.review}`,
    })!;
    const nodeId = String(node.id);
    nodes.set(stage.key, nodeId);
    const agent = createAgent(s, p, {
      nodeId,
      name: `${stage.name} AI`,
      purpose: stage.output,
      instructions: `负责${stage.name}。只使用指定输入的批准版本，不明确的需求先向总控提出问题。候选结果实际存储，审核后登记版本；不得从聊天记忆猜测定稿。\n${stage.review}`,
    });
    agents.set(stage.key, String(agent.id));
    createSession(s, p, { agentId: agent.id, title: `${stage.name}讨论` });
    createHighlight(s, p, {
      nodeId,
      kind: "goal",
      content: `演示讨论要点：${stage.review}`,
      rationale: "样例预置议题，供讨论使用；不是实际 AI 对话或用户已确认结论。",
    });
  }
  for (const asset of demoAssets) {
    const registered = createAsset(s, p, {
      code: asset.code,
      name: asset.name,
      kind: asset.kind,
      description: asset.description,
      entityKey: asset.entityKey ?? "",
      attributes: {
        ...asset.attributes,
        demo: true,
        nodeId: nodes.get(asset.stage)!,
        format: asset.attributes?.format ?? "JSON 设定文档",
      },
    });
    const version = createVersion(s, p, String(registered.id), {
      notes: asset.content
        ? "演示文字规范 v1；实际视觉与声音素材需另行制作和审核。"
        : "仅登记需求，等待实际文件。",
      sources: (asset.sources ?? []).map((code) => {
        const source = versions.get(code);
        if (!source) throw new Error(`缺少已发布的来源规范：${code}`);
        return source;
      }),
    });
    if (asset.content) {
      addFile(s, p, String(version.id), {
        name: `${asset.code}.json`,
        type: "application/json",
        bytes: Buffer.from(
          JSON.stringify(
            {
              name: asset.name,
              demo: true,
              description: asset.description,
              attributes: asset.attributes ?? {},
              content: asset.content,
            },
            null,
            2,
          ),
        ),
      });
      reviewVersion(s, p, String(version.id), {
        decision: "approved",
        scope: "演示文字设定与制作规范；不代表图像、声音或成片定稿",
        reason: "仅供工作台样例浏览；实际项目需重新讨论并审核。",
      });
      versions.set(asset.code, String(version.id));
    }
  }
  for (const stage of stages) {
    const item = createItem(s, p, {
      nodeId: nodes.get(stage.key),
      agentId: agents.get(stage.key),
      title: `${stage.name} · 交付事项`,
      objective: `输入要求：${stage.input}\n交付：${stage.output}`,
      acceptance: stage.review,
      inputs: demoAssets
        .filter((a) => a.stage === stage.key && versions.has(a.code))
        .map((a) => versions.get(a.code)!),
      dependencies: stage.parents.map((key) => items.get(key)!),
    });
    items.set(stage.key, String(item.id));
  }
  activateWorkflow(s, p, String(workflow.id));
  audit(s, p, "demo.seeded", "qinghe-v1", {
    textOnly: true,
    stages: stages.length,
  });
  return p;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const store = new Store(process.env.DATA_DIR || "./data");
  try {
    console.log(JSON.stringify({ projectId: seedDemo(store), name: demoName }));
  } finally {
    store.close();
  }
}
