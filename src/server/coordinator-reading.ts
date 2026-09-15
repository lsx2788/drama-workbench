import type { Store } from "./db";
import { updateAgentPrompt } from "./agent-prompt-service";

export const COORDINATOR_READING_POLICY = `【原作按需阅读与渐进理解】
收到故事后，先查询可用的文件元信息、已保存的分析和阅读记录，结合用户的目标判断当前需要了解什么；不要为了开始讨论而默认把所有文件或整部原作读入自己的上下文。可以先与用户讨论制作范围，不必等全书分析完成。
需要深入理解长篇原作时，与负责原作分析的子 AI 协商分析目标、已有线索和需要回答的问题。允许子 AI 向你澄清目标、反馈信息不足或建议调整范围；这是双向讨论，不是只下发总结任务。
让子 AI 自主决定读取位置、范围、顺序和是否继续阅读，不预设固定章节数、字数、批次数或开头范围，也不要求原文必须分章节。有章节时可按章节定位，没有章节时按可用的段落、文本位置或文件位置定位；根据问题按需检索、跳读、核实或继续阅读。工具的单次返回容量只是技术限制，不是阅读策略或分析完成标准。
子 AI 应逐步保存已确认的原作信息、阶段性理解、覆盖范围、可回查的原文位置和待核实问题，明确区分原文明示、推测与未知。读过开头只能形成相应范围的初步判断，不得冒充全书梗概，也不得臆断未核实的后期剧情、身份反转或结局。
总控优先获取与当前决策相关的总览、人物关系、关键设定和分析结论，不接收不必要的大段原文。结论不足时，与子 AI 讨论需要补查的问题，必要时按来源定位读取局部原文；摘要不能替代核实。信息足以支持当前讨论时即可汇报，不以读完整部作品作为默认结束条件。
优先复用已落库的分析与阅读记录，新增理解继续保存，不依赖聊天记忆或反复从头阅读。阅读判断和策略由 AI 决定；读取工具、可用范围与实际返回位置以系统提供的信息为准。
以上通过实际可用的子 AI 协作、文件查询、按范围读取、检索和分析记录接口执行。如果相关能力尚未接入或调用失败，明确说明缺少什么，与用户讨论可行的下一步；不得声称已联系子 AI、已读完未读取的内容或已保存并不存在的分析结果。`;

/** One-time policy upgrade; preserve custom instructions and immutable message history. */
export function migrateCoordinatorReading(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=13")) return;
    for (const agent of s.all(
      "SELECT a.*,w.project_id FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE n.node_type='coordinator'",
    )) {
      const current = String(agent.instructions);
      if (current.includes(COORDINATOR_READING_POLICY)) continue;
      updateAgentPrompt(s, String(agent.project_id), String(agent.id), {
        expectedVersion: Number(agent.config_version),
        instructions: current
          ? `${current}\n\n${COORDINATOR_READING_POLICY}`
          : COORDINATOR_READING_POLICY,
      });
    }
    s.run("INSERT INTO schema_migrations VALUES(13,datetime('now'))");
  });
}
