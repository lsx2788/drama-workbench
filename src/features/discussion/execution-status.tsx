import { Activity, ChevronRight } from "lucide-react";
import { taskDisplayTitle, type Message, type StudioProject } from "@/domain";
import { taskActivityGroups } from "./member-groups";
import { coordinatorStatus } from "./coordinator-status";

const labels: Record<string, string> = {
  working: "工作中",
  reviewing: "节点审核中",
  revising: "修改中",
  continuing: "等待继续",
  waiting: "等待总控答复",
  submitted: "已交总控验收",
  completed: "已验收",
  returned: "总控退回",
  failed: "执行失败",
  paused: "已暂停",
};

export function ExecutionBadge({
  execution,
}: {
  execution: NonNullable<Message["execution"]>;
}) {
  return (
    <span
      className={`studio-execution-status ${execution.status}`}
      title={execution.error}
    >
      {labels[execution.status] ?? execution.status}
    </span>
  );
}

export function ExecutionPanel({
  project,
  onTask,
}: {
  project: StudioProject;
  onTask: (id: string) => void;
}) {
  const groups = taskActivityGroups(project);
  const running = ["queued", "running"].includes(project.run?.status ?? "");
  const coordinator = coordinatorStatus(project);
  return (
    <section className="studio-execution-panel" aria-label="AI 工作状态">
      <h3>
        <Activity size={15} />
        AI 工作状态
        <span
          className={`studio-heartbeat ${coordinator.state}`}
          title={coordinator.detail}
          aria-label={`总控${coordinator.label}`}
        />
      </h3>
      {running && (
        <p className="studio-execution-round">本轮处理中，状态自动更新</p>
      )}
      <div className="studio-execution-list">
        <div
          className="studio-coordinator-progress"
          role="status"
          aria-live="polite"
        >
          <strong>总控 AI · {coordinator.label}</strong>
          <small>{coordinator.detail}</small>
        </div>
        {!groups.length && (
          <p className="studio-execution-empty">暂无进行中的节点任务</p>
        )}
        {groups.map((group) => (
          <div className="studio-execution-group" key={group.title}>
            <h4>
              {group.title}
              <small>{group.rows.length}</small>
            </h4>
            {group.rows.map((message) => (
              <button
                key={message.id}
                className="studio-execution-item"
                disabled={!project.tasks[message.taskId!]}
                onClick={() => onTask(message.taskId!)}
              >
                <span className="studio-execution-identity">
                  <strong>{message.sender}</strong>
                  <small>
                    {project.tasks[message.taskId!]
                      ? taskDisplayTitle(project.tasks[message.taskId!])
                      : "节点任务"}
                  </small>
                </span>
                <span className="studio-execution-state" aria-live="polite">
                  <ExecutionBadge execution={message.execution!} />
                  <ChevronRight size={12} />
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
