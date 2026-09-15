import type { Store } from "./db";
import { assert, audit, now } from "./common";
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
  const d = storyDiscussionInput.parse(input);
  const story = storyDetail(s, p, storyId);
  return s.transaction(() => {
    const previous = s.one(
      "SELECT m.session_id,m.id AS message_id,a.node_id FROM story_discussions d JOIN messages m ON m.id=d.message_id JOIN sessions ss ON ss.id=m.session_id JOIN agents a ON a.id=ss.agent_id WHERE d.story_id=?",
      storyId,
    );
    if (previous)
      return {
        nodeId: String(previous.node_id),
        sessionId: String(previous.session_id),
        messageId: String(previous.message_id),
        delivery: "stored",
        execution: "not_configured",
      };
    const catalog = listStoryPreferences(s);
    validateDiscussionPreferences(d.preferences, catalog);
    const agents = s
      .all(
        "SELECT a.* FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? AND w.status='active' AND n.node_type='coordinator'",
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
      `我已提交《${story.title}》，请先阅读并分析这个故事，再和我讨论制作方向。`,
      d.preferences.length
        ? `制作偏好：\n${d.preferences.map((preference) => preferenceLabel(preference, catalog)).join("\n")}`
        : "制作偏好尚未填写，阅读后再一起讨论。",
      `我的想法：\n${d.ideas.trim() ? d.ideas : "暂无补充，先一起讨论。"}`,
      "请结合附带的故事原文分析。以上是初步意向，我们可以继续讨论调整。",
    ].join("\n\n");
    const posted = postHumanMessage(s, p, String(session.id), { content });
    const messageId = String(posted.message!.id);
    s.run(
      "INSERT INTO story_discussions VALUES(?,?,?)",
      storyId,
      messageId,
      now(),
    );
    audit(s, p, "story.discussion_started", storyId, {
      sessionId: session.id,
      messageId,
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
