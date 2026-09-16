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
import {
  delegateWriting,
  postAgentMessage,
} from "../src/server/writer-collaboration";
import { audit, id } from "../src/server/common";
import {
  guideParts,
  guideText,
  guideNotice,
  guideOverview,
  guideRequirements,
  guideFramework,
  guidePeople,
  guideRelations,
} from "./guide-data";

const guideKey = "qinghe-preparation-v2";
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
    importKey: "9b4e8d60-54bb-4b7b-a532-cb19a3d5a7d1",
  });
  const p = String(imported.project.id),
    storyId = String(imported.story.id);
  return s.transaction(() => {
    s.run(
      "UPDATE projects SET description=?,goal=? WHERE id=?",
      "青河赈粮失踪，押运人之子与誊录员循两本账和一把旧剑查明粮食去向。虚构故事示例，讨论与成果为预置内容。",
      "制作三集、每集约两分钟的古装悬疑漫剧，保留从护亲到查证的变化。当前确定到三集原文归位。",
      p,
    );
    const coordinator = String(workspace(s, p).sessions[0].id);
    startStoryDiscussion(s, p, storyId, {
      ideas: `${guideNotice}\n我想做 3 集古装悬疑漫剧，每集约 2 分钟，画风写实一点。保留青年和中年两个时间层，不要把江绾改成只等男主救的人。`,
    });
    startPreparation(s, p, { coordinatorSessionId: coordinator });
    const setup = startPreparation(s, p, {
      coordinatorSessionId: coordinator,
      profile: "screenwriting",
    });
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
    const discuss = (from: string, to: string, content: string) =>
      postAgentMessage(s, p, to, {
        fromSessionId: from,
        content: `【预置讨论】${content}`,
      });
    discuss(
      coordinator,
      analyst,
      "请核对当前短篇的事件顺序、粮食数量和人物动机。特别区分沈恒签字、被扣押和被指潜逃三件事。只说明原作事实与依据，先不决定删改。",
    );
    const overview = savePreparationRecord(s, p, {
      kind: "overview",
      authorSessionId: analyst,
      content: { ...guideOverview, sources },
    });
    discuss(
      analyst,
      coordinator,
      `现有短篇全文已整理为概况 ${overview.id}。三百石分为县仓一百八十石、北山一百二十石；县仓六石湿损另算。江绾并不替沈恒担保，秦穆也先查证再处理。原文没有确定恋爱关系或案件终审结果。`,
    );
    reviewPreparation(s, p, String(overview.id), {
      coordinatorSessionId: coordinator,
      decision: "confirmed",
      reason: "概况与三段原文一致；保留数量区别和结案范围，不将猜测写成事实。",
    });
    const requirementMessage = postHumanMessage(s, p, coordinator, {
      content:
        "【预置讨论】就做三集、每集两分钟左右。重点是赈粮调查和沈砚逐渐学会查证，不加感情支线。江绾、船户和巡粮使都要发挥原来的作用，结尾不需要另写判刑。",
    });
    const requirements = savePreparationRecord(s, p, {
      kind: "requirements",
      authorSessionId: coordinator,
      basisId: overview.id,
      content: guideRequirements,
    });
    reviewPreparation(s, p, String(requirements.id), {
      coordinatorSessionId: coordinator,
      decision: "confirmed",
      userMessageId: requirementMessage.message!.id,
      reason:
        "已明确集数、时长、写实风格与保留人物；以现有短篇为范围，不外加支线。",
    });
    discuss(
      coordinator,
      writer,
      `依据需求 ${requirements.id} 设计三集框架。先说明每集的新发现、悬念与删减边界。秦穆的到场和剑鞘收据必须有前文铺垫，先不要写分场或对白。`,
    );
    const framework = savePreparationRecord(s, p, {
      kind: "framework",
      authorSessionId: writer,
      basisId: requirements.id,
      content: { ...guideFramework, sources },
    });
    discuss(
      writer,
      coordinator,
      `框架 ${framework.id} 将三集分别落在“粮去哪了”“父亲是否涉案”“独立证据如何对上”。第三集较密，建议压缩路程与点数过程，保留孟九报信和秦穆核查；不让巡粮使突然出现。两分钟先作为目标，具体场面确定后再核时。`,
    );
    const frameworkMessage = postHumanMessage(s, p, coordinator, {
      content:
        "【预置讨论】这个结构可以。第三集宁可少些追赶，也要让粮食去向讲清楚。先把三集对应原文存好；具体怎么改成每集的内容，下一步再讨论。",
    });
    reviewPreparation(s, p, String(framework.id), {
      coordinatorSessionId: coordinator,
      decision: "confirmed",
      userMessageId: frameworkMessage.message!.id,
      reason:
        "三集都有独立问题与承接线索；同意压缩过渡而保留核验。先建立入口与原文引用。",
    });
    const delegated = delegateWriting(s, p, {
      parentSessionId: writer,
      requestKey: id(),
      name: "线索与数量核对 AI",
      objective:
        "【预置讨论】核对三百石、一百八十石、一百二十石、六石湿损及九十六石加二十四石的对应关系；检查秦穆行程、铜钉和收据的铺垫。将疑问直接反馈给上级编剧，只返回依据与结论，不写剧本。",
      sourceIds: [storyId],
      recordIds: [String(framework.id)],
    });
    discuss(
      String(delegated.child_session_id),
      writer,
      "数量链闭合：180＋120＝300，96＋24＝120，6 石湿损属于县仓的 180 石。首段口信预告秦穆行程和新铜钉；末段由孟九报信促成提前核仓。第二集抄录只是线索，第三集须保留原始交割联、收据、车夫出仓簿和实物核对。",
    );
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
    discuss(
      writer,
      coordinator,
      `三集入口已建立：${episodes.episodes.map((episode: { code: string; name: string }) => `${episode.code} ${episode.name}`).join("；")}。原文按原有三部分关联，未改写。数量与线索核对已记录在编剧内部讨论中，下一步需讨论各集具体改编。`,
    );
    const knowledge = proposeKnowledge(s, p, {
      authorSessionId: analyst,
      payload: {
        summary: "六名人物及父子信任变化、报信与核查关系。",
        entities: guidePeople.map((person) => ({
          ...person,
          kind: "person",
          sources,
        })),
        relations: guideRelations.map((relation) => ({ ...relation, sources })),
      },
    });
    reviewKnowledge(s, p, knowledge.id, {
      coordinatorSessionId: coordinator,
      decision: "confirmed",
      reason:
        "人物动机和关系均有当前原文依据；按阶段保留沈砚对父亲的坚信、怀疑与重新信任。",
    });
    const nodeNotes = [
      {
        nodeId: setup.coordinator_node_id,
        goal: "保持证据推动情节：不增加恋爱支线，不用拔剑替代核查。三集约两分钟，第三集以说清粮食去向为优先。",
        objective:
          "围绕《青禾剑录》的改编方向，与创作者确认体量和取舍，协调原作分析与编剧成果。",
      },
      {
        nodeId: setup.analysis_node_id,
        goal: "六石湿损属于县仓入粮，不是私仓分流；沈恒经手、签字、被扣押和被诬称潜逃要分别记录。原文未写终审判决。",
        objective:
          "梳理赈粮数量、两本账的时间差与人物立场，提供能回查的原文依据。",
      },
      {
        nodeId: setup.writing_node_id,
        goal: "第一集留下异常运单，第二集留下父亲签名与收据，第三集回收报信和封袋号。可压缩过渡，不删独立证据来源。",
        objective:
          "在三集约两分钟的目标下安排悬念与衔接，保留青年/中年回忆结构，完成原文归位。",
      },
    ];
    for (const note of nodeNotes) {
      s.run(
        "UPDATE nodes SET objective=? WHERE id=?",
        note.objective,
        String(note.nodeId),
      );
      createHighlight(s, p, {
        nodeId: note.nodeId,
        kind: "goal",
        status: "confirmed",
        content: note.goal,
        rationale: "依据已确认的故事范围、制作目标和三集框架。",
      });
    }
    updateNodeState(s, p, String(setup.analysis_node_id), "completed");
    updateNodeState(s, p, String(setup.writing_node_id), "completed");
    // Replace the known old fixture only, never projects found by a loose name match.
    for (const old of s.all(
      "SELECT DISTINCT project_id FROM audit_events WHERE (action='demo.seeded' AND target_id='qinghe-v1') OR (action='guide.seeded' AND target_id='qinghe-preparation-v1')",
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
