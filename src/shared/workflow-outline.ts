export interface WorkflowOutline {
  title: string;
  summary: string;
  steps: {
    key: string;
    name: string;
    objective: string;
    outputs: string[];
    dependsOn: string[];
  }[];
  questions: string[];
}
