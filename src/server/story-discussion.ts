import type { Store } from "./db";
import { assert, audit, now, DomainError } from "./common";
import { createSession, postHumanMessage } from "./collaboration-service";
import { storyDetail } from "./story-service";
import { type StoryDiscussion } from "../shared/story-import";
import { preferenceLabel } from "../shared/story-preferences";
import { listStoryPreferences } from "./story-preference-catalog";
import {
  storyDiscussionInput,
  validateDiscussionPreferences,
} from "./story-discussion-input";

/** A separate, retryable handoff. Import remains storage-only even if this fails. */
export function startStoryDiscussion(
  s: Store,
  p: string,
  storyId: string,
  input: unknown = {},
): StoryDiscussion {
  return startStoriesDiscussion(s, p, [storyId], input);
}

export function startStoriesDiscussion(
  s: Store,
  p: string,
  storyIds: string[],
  input: unknown = {},
): StoryDiscussion {
  assert(
    storyIds.length > 0 &&
      storyIds.length <= 20 &&
      new Set(storyIds).size === storyIds.length,
    "请选择 1–20 个不同的故事文件",
  );
  const d = storyDiscussionInput.parse(input);
  const stories = storyIds.map((key) => storyDetail(s, p, key));
  const story = stories[0];
  return s.transaction(() => {
    const existing = storyIds.flatMap((key) =>
      s.all(
        "SELECT m.session_id,m.id AS message_id,a.node_id FROM story_discussions d JOIN messages m ON m.id=d.message_id JOIN sessions ss ON ss.id=m.session_id JOIN agents a ON a.id=ss.agent_id WHERE d.story_id=?",
        key,
      ),
    );
    if (existing.length) {
      const previous = existing[0];
      const attached = s.all(
        "SELECT story_id FROM story_discussions WHERE message_id=? ORDER BY position",
        String(previous.message_id),
      );
      // Do not silently drop newly supplied attachments or combine distinct old handoffs.
      if (
        existing.length !== storyIds.length ||
        existing.some((row) => row.message_id !== previous.message_id) ||
        attached.length !== storyIds.length ||
        attached.some((row, index) => row.story_id !== storyIds[index])
      )
        throw new DomainError(
          "DISCUSSION_CONFLICT",
          "这些文件已参与其他交接，请查看已有聊天",
          409,
        );
      return {
        nodeId: String(previous.node_id),
        sessionId: String(previous.session_id),
        messageId: String(previous.message_id),
        delivery: "stored",
        execution: "not_configured",
      };
    }
    const catalog = listStoryPreferences(s);
    validateDiscussionPreferences(d.preferences, catalog);
    const agents = s
      .all(
        "SELECT a.* FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? AND n.node_type='coordinator' AND (w.status='active' OR (w.status='draft' AND NOT EXISTS(SELECT 1 FROM workflows current WHERE current.project_id=w.project_id AND current.status='active')))",
        p,
      )
      .filter((a) => !d.agentId || a.id === d.agentId);
    assert(
      agents.length === 1,
      agents.length
        ? "存在多个总控 AI，请指定 agentId 后重试"
        : "尚无可用的总控 AI，故事已保存，可稍后继续讨论",
    );
    const agent = agents[0];
    const emptySessions = s.all(
      "SELECT * FROM sessions ss WHERE ss.agent_id=? AND ss.status='open' AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.session_id=ss.id)",
      String(agent.id),
    );
    const session =
      emptySessions.length === 1
        ? emptySessions[0]
        : createSession(s, p, {
            agentId: agent.id,
            title: `故事讨论 · ${story.title}`.slice(0, 200),
          });
    const content = [
      stories.length === 1
        ? `我已提交《${story.title}》，请先了解已有资料，按需分析这个故事，与我讨论制作方向。`
        : `我已提交 ${stories.length} 个故事文件，请先了解各文件的基本信息和已有分析，按需理解故事，与我讨论制作方向。`,
      d.preferences.length
        ? `制作偏好：\n${d.preferences.map((preference) => preferenceLabel(preference, catalog)).join("\n")}`
        : "制作偏好尚未填写，阅读后再一起讨论。",
      `我的想法：\n${d.ideas.trim() ? d.ideas : "暂无补充，先一起讨论。"}`,
      stories
        .map((source) => `故事原文路径：${source.download_url}`)
        .join("\n"),
      "请围绕当前讨论需要按需了解附带的原作，不必先通读全部内容；需要时与原作分析子 AI 协作，由其自主决定阅读范围。以上是初步意向，我们可以继续讨论调整。",
      "请先梳理已知条件，和我确认基本制作信息；未填写的内容请提出建议后再确认。在我确认关键制作方向前，先不要开始剧本拆解、分镜或资产制作。",
    ].join("\n\n");
    const posted = postHumanMessage(s, p, String(session.id), { content });
    const messageId = String(posted.message!.id);
    stories.forEach((source, position) => {
      s.run(
        "INSERT INTO story_discussions(story_id,message_id,created_at,position) VALUES(?,?,?,?)",
        String(source.id),
        messageId,
        now(),
        position,
      );
      audit(s, p, "story.discussion_started", String(source.id), {
        sessionId: session.id,
        messageId,
      });
    });
    return {
      nodeId: String(agent.node_id),
      sessionId: String(session.id),
      messageId,
      delivery: "stored",
      execution: "not_configured",
    };
  });
}
