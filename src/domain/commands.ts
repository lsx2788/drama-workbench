import type { OutputStructure } from "./expansion";
import type { StudioProject } from "./types";
import { missingInputs, isManual, shotId } from "./queries";
export type TaskAction =
  | { type: "toggle-executor" }
  | { type: "toggle-review" }
  | { type: "attach" }
  | {
      type: "save";
      text: string;
      structure?: OutputStructure;
      assetIds?: string[];
      reuseReason?: string;
      assetName?: string;
      assetCategory?: "人物" | "场景" | "道具";
    }
  | { type: "review" }
  | { type: "request-review"; reason: string }
  | { type: "accept"; mediaPresent?: boolean; imagesPresent?: boolean }
  | { type: "return"; reason: string };

/** Pure transitions: presentation order never becomes a task dependency. */
export function changeTask(
  project: StudioProject,
  id: string,
  action: TaskAction,
): StudioProject {
  const current = project.tasks[id];
  if (!current) throw new Error("找不到这个任务");
  const task = { ...current };
  if (action.type === "toggle-executor") task.enabled = !task.enabled;
  else if (action.type === "toggle-review")
    task.reviewEnabled = !task.reviewEnabled;
  else {
    if (!task.enabled) throw new Error("请先恢复这个任务");
    if (
      missingInputs(project, task).length &&
      !(["save", "attach"].includes(action.type) && isManual(task))
    )
      throw new Error("必要的前置产出尚未验收，暂时不能开展此任务");
    if (action.type === "attach") {
      if (task.delivery === "approved")
        throw new Error("已验收成果不能直接追加文件");
      if (task.text)
        task.history = [
          ...task.history,
          { text: task.text, revision: task.revision, delivery: task.delivery },
        ];
      task.revision++;
      if (isManual(task) && !task.text.trim())
        task.text =
          "已上传人工制作的视频，待核对画面、时长、声音与制作要求后验收。";
      task.delivery = task.text ? "draft" : "empty";
      task.rejection = undefined;
    } else if (action.type === "save") {
      if (!action.text.trim()) throw new Error("请先填写产出内容");
      if (
        task.delivery === "approved" &&
        !["source", "script", "storyboard"].includes(task.kind)
      )
        throw new Error("这份产出已验收；本版暂不支持修改已使用的基准");
      task.history = task.text
        ? [
            ...task.history,
            {
              text: task.text,
              revision: task.revision,
              delivery: task.delivery,
            },
          ]
        : task.history;
      task.text = action.text;
      task.revision++;
      task.delivery = "draft";
      task.rejection = undefined;
      task.assetIds = action.assetIds ?? task.assetIds;
      task.reuseReason = action.reuseReason ?? task.reuseReason;
      task.assetName = action.assetName ?? task.assetName;
      task.assetCategory = action.assetCategory ?? task.assetCategory;
      if (
        task.assetIds.some(
          (assetId) =>
            !project.assets.some(
              (a) => a.id === assetId && a.status === "approved",
            ),
        )
      )
        throw new Error("只能引用审核通过的资产");
    } else if (action.type === "request-review") {
      if (
        task.delivery !== "returned" ||
        !task.reviewEnabled ||
        !task.text ||
        isManual(task)
      )
        throw new Error("仅已退回且开启独立审核的产出可重新送审");
      if (!action.reason.trim()) throw new Error("请说明重新送审依据");
      task.delivery = "draft";
      task.rejection = undefined;
    } else if (action.type === "review") {
      if (task.delivery !== "draft" || !task.reviewEnabled || isManual(task))
        throw new Error("当前任务无需执行内部审核");
      if (task.kind === "assets" && !task.reuseReason.trim())
        throw new Error("请记录查询结果及复用或新建原因，供审核核查");
      task.delivery = "reviewed";
    } else if (action.type === "accept") {
      if (
        task.delivery !== "reviewed" &&
        !(task.delivery === "draft" && (!task.reviewEnabled || isManual(task)))
      )
        throw new Error("请先提交产出并完成启用的内部审核");
      if (isManual(task) && !action.mediaPresent)
        throw new Error("请先添加人工制作的视频");
      if (task.kind === "frames" && !action.imagesPresent)
        throw new Error("请先添加镜头画面，只有制作说明不能视为图片完成");
      if (task.kind === "assets" && !task.reuseReason.trim())
        throw new Error("请记录资产查询及复用判断");
      if (
        task.kind === "assets" &&
        action.imagesPresent &&
        (!task.assetName?.trim() || !task.assetCategory)
      )
        throw new Error("请填写新建图片资产的名称和分类并保存");
      task.delivery = "approved";
    } else {
      if (!action.reason.trim()) throw new Error("请填写退回原因");
      if (task.delivery === "empty") throw new Error("当前产出不能退回");
      task.delivery = "returned";
      task.rejection = action.reason.trim();
    }
  }
  const text =
    action.type === "toggle-executor"
      ? `${task.title}：${task.enabled ? "已恢复，按实际前置条件继续" : "已暂停；其他无依赖分支仍可开展"}`
      : action.type === "toggle-review"
        ? `${task.title}：内部审核${task.reviewEnabled ? "已启用" : "已跳过（用户禁用）"}。总控验收保留。`
        : action.type === "accept"
          ? `${task.title}：演示总控验收通过，产出 v${task.revision} 可供后续引用。`
          : action.type === "return"
            ? `${task.title}：已退回。${task.rejection}`
            : action.type === "request-review"
              ? `${task.title}：原产出 v${task.revision} 重新送审，未改文件或验收状态。${action.reason}`
              : action.type === "review"
                ? `${task.title}：演示内部审核通过，等待总控验收。`
                : `${task.title}：已保存产出 v${task.revision}，尚未验收。`;
  let assets =
    action.type === "accept" && task.kind === "frames"
      ? [
          ...project.assets,
          {
            id: `FRAME-${task.episode}-${task.shot}`,
            name: `第 ${task.episode} 集 · 镜头 ${task.shot} 画面`,
            category: "镜头画面" as const,
            status: "approved" as const,
            description: task.text,
            version: task.revision,
            sourceIds: [
              ...new Set([
                ...project.tasks[shotId(task.episode!, task.shot!, "assets")]
                  .assetIds,
                ...project.assets
                  .filter(
                    (a) =>
                      a.status === "approved" &&
                      a.taskId === shotId(task.episode!, task.shot!, "assets"),
                  )
                  .map((a) => a.id),
              ]),
            ],
            taskId: id,
          },
        ]
      : project.assets;
  if (
    action.type === "accept" &&
    task.kind === "assets" &&
    action.imagesPresent
  ) {
    assets = [
      ...assets,
      {
        id:
          task.episode !== undefined && task.shot !== undefined
            ? `IMAGE-${task.episode}-${task.shot}`
            : `IMAGE-${task.id}`,
        name: task.assetName!.trim(),
        category: task.assetCategory!,
        status: "approved",
        description: task.text,
        version: task.revision,
        sourceIds: task.assetIds,
        taskId: id,
      },
    ];
  }
  return {
    ...project,
    assets,
    tasks: { ...project.tasks, [id]: task },
    events: [
      ...project.events,
      {
        id: crypto.randomUUID(),
        action: action.type,
        revision: task.revision,
        text,
        taskId: id,
        time: new Date().toISOString(),
      },
    ],
  };
}
