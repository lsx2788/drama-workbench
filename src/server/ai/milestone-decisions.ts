import type { StudioProject, Task } from "../../domain/types";
import { isCharacterBasis } from "../../domain/character-basis";

/** Only direction-setting deliveries, not every expanded shot or supplementary image. */
export function decisionMilestones(project: StudioProject): Task[] {
  return Object.values(project.tasks).filter((task) => {
    if (task.delivery !== "approved" || task.placeholder || task.retirement)
      return false;
    if (task.kind === "script" || task.kind === "storyboard") return true;
    if (task.kind === "assets" && isCharacterBasis(task.imageSpec?.purpose))
      return true;
    return (
      ["assets", "frames"].includes(task.kind) &&
      task.episode === project.representativeEpisode &&
      task.shot ===
        (project.episodes.find((episode) => episode.number === task.episode)
          ?.representativeShot ?? project.representativeShot)
    );
  });
}

export function milestoneKey(task: Task) {
  return `${task.id}@${task.revision}`;
}

export function milestoneInstruction(tasks: Task[]) {
  return `系统检测到关键交付已验收，但本轮结束时没有向用户发出待确认问题：${tasks.map((task) => `${task.title}（${task.id}，v${task.revision}）`).join("、")}。
这是一次收尾询问，不是用户批准继续制作。先查询 project，并读取 brief 的已确认范围以及这些任务的真实状态。只调用一次 ask_user，合并说明：1. 已完成什么；2. 为什么停在这里（已达本轮边界、需选方向、待人工制作等，以已保存事实为准）；3. 用户现在需要选择什么，以及你的建议。
若需求明确只做文字，不得直接生图或暗示已获授权；询问保留当前交付、修改哪一处，还是另行确认新增制作范围。若只是首批代表产出，不得说全片完成；询问按当前方向补齐或调整。已有人物与分镜等齐备时，可介绍资产库/制作流程的资源导出；缺图时不能说资源包已就绪。回复和跳过都不自动授权扩大范围。
这次只有查询、读取和询问权限，不能委派、验收或制作。不再发一条重复的最终总结，ask_user 就是本次对用户的交付。`;
}
