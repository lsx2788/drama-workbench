import type { Store } from "./db";
import { createProject, createWorkflow, createNode } from "./project-service";
import { createAgent, createSession } from "./collaboration-service";
import { DEFAULT_COORDINATOR_INSTRUCTIONS } from "./coordinator-intake";

/** A new workspace has a conversation entry, not a preselected production template. */
export function createProjectWithCoordinator(s: Store, input: unknown) {
  return s.transaction(() => {
    const project = createProject(s, input),
      p = String(project.id);
    const workflow = createWorkflow(s, p, { name: "制作流程" })!;
    const node = createNode(s, p, {
      workflowId: workflow.id,
      name: "总控协调",
      nodeType: "coordinator",
      objective:
        "与创作者讨论故事目标，保存关键结论；根据已确认的需求逐步定义制作节点、分集和参与 AI。",
    })!;
    const agent = createAgent(s, p, {
      nodeId: node.id,
      name: "总控 AI",
      purpose: "与创作者讨论并协调当前项目",
      instructions: DEFAULT_COORDINATOR_INSTRUCTIONS,
    });
    createSession(s, p, { agentId: agent.id, title: "项目讨论" });
    return project;
  });
}
