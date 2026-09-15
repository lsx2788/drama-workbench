import { pathToFileURL } from "node:url";
import { Store } from "../src/server/db";
import { importStory } from "../src/server/story-service";
import { workspace } from "../src/server/read-service";
import { archiveProject, updateNodeState } from "../src/server/project-service";
import {
  createHighlight,
  postHumanMessage,
} from "../src/server/collaboration-service";
import { startStoryDiscussion } from "../src/server/story-discussion";
import {
  startPreparation,
  savePreparationRecord,
  reviewPreparation,
} from "../src/server/preparation-service";
import { createEpisodes } from "../src/server/episode-service";
import {
  proposeKnowledge,
  reviewKnowledge,
} from "../src/server/knowledge-service";
import { delegateWriting } from "../src/server/writer-collaboration";
import { audit, id } from "../src/server/common";
import { guideParts, guideText, guideNotice } from "./guide-data";

const guideKey = "qinghe-preparation-v1";
/** Explicit guide refresh, not startup seeding. Earlier guides remain recoverable. */
export function seedGuide(s: Store) {
  const existing = s.one(
    "SELECT project_id FROM audit_events WHERE action='guide.seeded' AND target_id=?",
    guideKey,
  );
  if (existing) return String(existing.project_id);
  const imported = importStory(s, {
    source: "text",
    title: "青禾剑录",
    text: guideText,
    importKey: "bdfb4ccf-1545-4fba-897c-637ac0057e01",
  });
  const p = String(imported.project.id),
    storyId = String(imported.story.id);
  return s.transaction(() => {
    s.run(
      "UPDATE projects SET description=?,goal=? WHERE id=?",
      "从故事原文到分集入口的流程引导。预置概况、需求与框架可点击查看；AI 尚未实际运行。",
      "先看总控讨论，再打开制作流程。人物关系在故事资料中；分集只存原文，集内制作留待讨论。",
      p,
    );
    const coordinator = String(workspace(s, p).sessions[0].id);
    startStoryDiscussion(s, p, storyId, {
      ideas: `${guideNotice}\n示例意向：古装悬疑漫剧，3 集，每集约 90 秒，保留青年与中年沈砚两个时间层。`,
    });
    const setup = startPreparation(s, p, { coordinatorSessionId: coordinator });
    const w = workspace(s, p);
    const analyst = String(
      w.sessions.find((row) => row.node_id === setup.analysis_node_id)!.id,
    );
    const writer = String(
      w.sessions.find((row) => row.node_id === setup.writing_node_id)!.id,
    );
    let startByte = 0;
    const sources = guideParts.map((part) => {
      const endByte = startByte + Buffer.byteLength(part.text);
      const source = {
        storyId,
        startByte,
        endByte,
        encoding: "utf-8",
        locator: `《青禾剑录》· ${part.name}原文`,
      };
      startByte = endByte;
      return source;
    });
    const overview = savePreparationRecord(s, p, {
      kind: "overview",
      authorSessionId: analyst,
      content: {
        title: "原作概况与已知人物",
        summary:
          "沈砚与江绾凭运单、官账和剑鞘收据，追查赈灾粮去向。故事由中年回忆青年经历，核心是查证与信任。",
        details: `${guideNotice}\n覆盖范围：本项目保存的三段原文节选，不代表已经分析一部长篇小说。\n主要人物：20 岁沈砚、40 岁沈砚（同一人的不同阶段）、江绾。父亲通过线索被提及。\n青禾剑是证物载体，不具有法术。`,
        sources,
        unresolved: [
          "人物外貌、服装和视觉风格尚未设计；不能把文字描述当作定稿画像。",
        ],
      },
    });
    reviewPreparation(s, p, String(overview.id), {
      coordinatorSessionId: coordinator,
      decision: "confirmed",
      reason: `${guideNotice} 已列明节选范围与未知信息。`,
    });
    const requirementMessage = postHumanMessage(s, p, coordinator, {
      content:
        "【引导用例预置 · 需求确认示例】先制作原文三段内容，共 3 集，每集约 90 秒。保留赈灾粮调查主线和中年回忆，不增添法术或新支线。",
    });
    const requirements = savePreparationRecord(s, p, {
      kind: "requirements",
      authorSessionId: coordinator,
      basisId: overview.id,
      content: {
        title: "制作范围与体量",
        summary: "3 集古装悬疑漫剧，每集约 90 秒，覆盖现有三段原文。",
        details: guideNotice,
        episodeCount: 3,
        minutesPerEpisode: 1.5,
        scope: "渡口相遇 → 官账比对 → 谷仓公开证据",
        constraints: [
          "保留 20 岁与 40 岁沈砚两个阶段。",
          "青禾剑不带法术；不增加原文外支线。",
          "目前只确定框架与原文分配，不写分场、对白或分镜。",
        ],
      },
    });
    reviewPreparation(s, p, String(requirements.id), {
      coordinatorSessionId: coordinator,
      decision: "confirmed",
      userMessageId: requirementMessage.message!.id,
      reason: guideNotice,
    });
    const framework = savePreparationRecord(s, p, {
      kind: "framework",
      authorSessionId: writer,
      basisId: requirements.id,
      content: {
        title: "三集改编框架",
        summary:
          "第一集建立相遇与异常运单；第二集追查账册并质疑父亲身份；第三集用收据完成澄清和开仓。",
        details: `${guideNotice}\n叙事顺序：中年回忆进入青年线，结尾回到中年。\n取舍：本次保留三段，没有跳章；不另写衙役背景或新的感情支线。\n衔接：运单引向官账，官账引向谷仓，剑鞘收据完成父亲身份的解释。\n体量仍为规划目标，是否需要压缩在后续分集讨论中核对。`,
        sources,
        unresolved: ["各集具体场景、节奏、对白与画面尚未讨论。"],
      },
    });
    const frameworkMessage = postHumanMessage(s, p, coordinator, {
      content:
        "【引导用例预置 · 框架确认示例】同意这三集框架。由编剧直接建立各集入口，把原始文案放好；先不开展集内制作。",
    });
    reviewPreparation(s, p, String(framework.id), {
      coordinatorSessionId: coordinator,
      decision: "confirmed",
      userMessageId: frameworkMessage.message!.id,
      reason: guideNotice,
    });
    delegateWriting(s, p, {
      parentSessionId: writer,
      requestKey: id(),
      name: "原文范围核对 AI",
      objective: `【引导用例预置任务】核对三段原文对应范围与前后衔接，只向上级编剧反馈来源位置和疑问，不生成具体剧本。${guideNotice}`,
      sourceIds: [storyId],
      recordIds: [String(framework.id)],
    });
    const episodes = createEpisodes(s, p, {
      writerSessionId: writer,
      frameworkId: framework.id,
      requestKey: id(),
      units: guideParts.map((part, index) => ({
        name: `第 ${index + 1} 集 · ${part.name}`,
        summary: part.summary,
        sources: [sources[index]],
      })),
    });
    const knowledge = proposeKnowledge(s, p, {
      authorSessionId: analyst,
      payload: {
        summary: "原文中已知的人物与关系；画像尚未制作。",
        entities: [
          {
            code: "shen_yan",
            kind: "person",
            name: "沈砚",
            role: "主要人物",
            description:
              "20 岁是调查赈灾粮的青年；40 岁是重返旧渡的回忆者。是同一人，未来画像须按年龄分开登记。",
            sources: [sources[0], sources[2]],
          },
          {
            code: "jiang_wan",
            kind: "person",
            name: "江绾",
            role: "共同查证者",
            description:
              "掌握账册线索，与沈砚协作。现有原文未确认恋爱关系，也未说明具体外貌。",
            sources,
          },
          {
            code: "father",
            kind: "person",
            name: "沈砚之父",
            role: "线索人物",
            description: "通过剑、签名和收据出现；原文结尾确认其参与查验失粮。",
            sources,
          },
        ],
        relations: [
          {
            code: "partners",
            from: "shen_yan",
            to: "jiang_wan",
            label: "协作查证",
            period: "青年调查期间",
            sources,
          },
          {
            code: "kinship",
            from: "shen_yan",
            to: "father",
            label: "父子",
            period: "全篇",
            sources,
          },
        ],
      },
    });
    reviewKnowledge(s, p, knowledge.id, {
      coordinatorSessionId: coordinator,
      decision: "confirmed",
      reason: guideNotice,
    });
    for (const [nodeId, content] of [
      [
        setup.coordinator_node_id,
        "阅读顺序：原作概况 → 制作需求 → 改编框架 → 三个分集入口。点击故事资料查看人物关系。总控只接收成果清单，不搬运整批原文。",
      ],
      [
        setup.analysis_node_id,
        "这里只给原作事实、阅读范围和未知项，不替用户决定改编取舍。",
      ],
      [
        setup.writing_node_id,
        `编剧已按示例框架建立 ${episodes.episodes.length} 个入口。每集可查看独立原文片段和相邻集。下级核对任务可在聊天列表查看，尚未实际执行。`,
      ],
    ])
      createHighlight(s, p, {
        nodeId,
        kind: "goal",
        content,
        rationale: guideNotice,
      });
    updateNodeState(s, p, String(setup.analysis_node_id), "completed");
    updateNodeState(s, p, String(setup.writing_node_id), "completed");
    // Replace the known old fixture only, never projects found by a loose name match.
    for (const old of s.all(
      "SELECT DISTINCT project_id FROM audit_events WHERE action='demo.seeded' AND target_id='qinghe-v1'",
    ))
      archiveProject(s, String(old.project_id), true);
    audit(s, p, "guide.seeded", guideKey, {
      preauthored: true,
      runtimeExecuted: false,
      episodeIds: episodes.episodes.map(
        (episode: { id: string }) => episode.id,
      ),
    });
    return p;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const s = new Store(process.env.DATA_DIR || "./data");
  try {
    console.log(JSON.stringify({ projectId: seedGuide(s), name: "青禾剑录" }));
  } finally {
    s.close();
  }
}
