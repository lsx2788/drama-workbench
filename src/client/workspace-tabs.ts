export type ProjectView = "coordinator" | "flow" | "assets";
export type PageKind = ProjectView | "node" | "chat";
export interface WorkspacePage {
  id: string;
  projectId: string;
  kind: PageKind;
  title: string;
  targetId?: string;
  quoteId?: string;
}
export interface TabState {
  pages: WorkspacePage[];
  activeId: string;
}
export type TabAction =
  | { type: "open"; page: Omit<WorkspacePage, "id"> }
  | { type: "select"; id: string }
  | { type: "close"; id: string }
  | { type: "clearQuote"; id: string };

export const pageTitles: Record<ProjectView, string> = {
  coordinator: "总控聊天",
  flow: "制作流程",
  assets: "故事资产库",
};

export function tabReducer(state: TabState, action: TabAction): TabState {
  if (action.type === "open") {
    const { page } = action;
    const id = `${page.projectId}:${page.kind}:${page.kind === "chat" || page.kind === "node" ? page.targetId : ""}`;
    const existing = state.pages.find((p) => p.id === id);
    return {
      activeId: id,
      pages: existing
        ? state.pages.map((p) => (p.id === id ? { ...p, ...page, id } : p))
        : [...state.pages, { ...page, id }],
    };
  }
  if (action.type === "select")
    return state.pages.some((p) => p.id === action.id)
      ? { ...state, activeId: action.id }
      : state;
  if (action.type === "clearQuote")
    return {
      ...state,
      pages: state.pages.map((p) =>
        p.id === action.id ? { ...p, quoteId: undefined } : p,
      ),
    };
  const index = state.pages.findIndex((p) => p.id === action.id);
  if (index < 0) return state;
  const pages = state.pages.filter((p) => p.id !== action.id);
  return {
    pages,
    activeId:
      state.activeId === action.id
        ? (pages[Math.min(index, pages.length - 1)]?.id ?? "")
        : state.activeId,
  };
}
